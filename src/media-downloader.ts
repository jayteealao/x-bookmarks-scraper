/**
 * Media Downloader
 * Downloads tweet media (images, videos) to local storage
 */

import { writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import type { TweetMediaEntity } from './types.js';
import { getMediaExtension, ensureDir, retryWithBackoff } from './utils.js';

export interface MediaDownloadResult {
  mediaKey: string;
  localPath: string;
  success: boolean;
  error?: string;
}

export class MediaDownloader {
  private outputDir: string;
  private downloadedMedia: Set<string> = new Set();
  private failedDownloads: Map<string, string> = new Map();
  private concurrentDownloads: number = 0;
  private maxConcurrent: number = 3;

  constructor(outputDir: string = 'out/media') {
    this.outputDir = outputDir;
  }

  /**
   * Initialize output directory
   */
  async initialize(): Promise<void> {
    await ensureDir(this.outputDir);
    console.log(`[MediaDownloader] Initialized: ${this.outputDir}`);
  }

  /**
   * Download media with retry logic
   */
  async download(media: TweetMediaEntity): Promise<MediaDownloadResult> {
    const mediaKey = media.mediaKey;

    // Skip if already downloaded
    if (this.downloadedMedia.has(mediaKey)) {
      return {
        mediaKey,
        localPath: this.getLocalPath(mediaKey, media.type),
        success: true,
      };
    }

    // Skip if previously failed
    if (this.failedDownloads.has(mediaKey)) {
      return {
        mediaKey,
        localPath: '',
        success: false,
        error: this.failedDownloads.get(mediaKey),
      };
    }

    // Wait if too many concurrent downloads
    while (this.concurrentDownloads >= this.maxConcurrent) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.concurrentDownloads++;

    try {
      const url = this.getBestUrl(media);
      if (!url) {
        const error = 'No URL available';
        this.failedDownloads.set(mediaKey, error);
        return { mediaKey, localPath: '', success: false, error };
      }

      const localPath = this.getLocalPath(mediaKey, media.type);

      // Skip if file already exists
      if (existsSync(localPath)) {
        this.downloadedMedia.add(mediaKey);
        return { mediaKey, localPath, success: true };
      }

      // Download with retry
      const buffer = await retryWithBackoff(async () => {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return await response.arrayBuffer();
      }, 3);

      // Write to file
      await writeFile(localPath, Buffer.from(buffer));

      this.downloadedMedia.add(mediaKey);
      return { mediaKey, localPath, success: true };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.failedDownloads.set(mediaKey, errorMsg);
      console.warn(`[MediaDownloader] Failed to download ${mediaKey}: ${errorMsg}`);

      return {
        mediaKey,
        localPath: '',
        success: false,
        error: errorMsg,
      };
    } finally {
      this.concurrentDownloads--;
    }
  }

  /**
   * Download multiple media in batch
   */
  async downloadBatch(mediaList: TweetMediaEntity[]): Promise<MediaDownloadResult[]> {
    return Promise.all(mediaList.map(media => this.download(media)));
  }

  /**
   * Get best URL for media
   */
  private getBestUrl(media: TweetMediaEntity): string | null {
    // For photos, prefer direct URL
    if (media.type === 'photo' && media.url) {
      // Ensure we get the highest quality version
      return media.url.replace(/\?format=.*$/, '') + '?format=jpg&name=large';
    }

    // For videos, we only have preview image URL in most cases
    // Full video download would require additional API calls
    if (media.type === 'video' || media.type === 'animated_gif') {
      return media.previewImageUrl || null;
    }

    return media.url || media.previewImageUrl || null;
  }

  /**
   * Get local file path for media
   */
  private getLocalPath(mediaKey: string, type: string): string {
    const ext = getMediaExtension(type);
    return `${this.outputDir}/${mediaKey}.${ext}`;
  }

  /**
   * Get download stats
   */
  getStats(): {
    downloaded: number;
    failed: number;
    failedList: Array<{ mediaKey: string; error: string }>;
  } {
    return {
      downloaded: this.downloadedMedia.size,
      failed: this.failedDownloads.size,
      failedList: Array.from(this.failedDownloads.entries()).map(([mediaKey, error]) => ({
        mediaKey,
        error,
      })),
    };
  }

  /**
   * Clear downloaded media tracking (for new session)
   */
  reset(): void {
    this.downloadedMedia.clear();
    this.failedDownloads.clear();
  }
}
