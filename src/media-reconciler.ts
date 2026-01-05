/**
 * Media Reconciler
 * Fetches any missing images after extraction completes
 * Runs as a post-processing step to ensure complete media capture
 */

import type { SQLiteWriter } from './sqlite-writer.js';

export interface MediaReconciliationResult {
  totalImages: number;
  alreadyCaptured: number;
  fetched: number;
  failed: number;
  skipped: number;
}

interface MediaRecord {
  mediaKey: string;
  url: string;
  type: string;
}

export class MediaReconciler {
  private sqliteWriter: SQLiteWriter;
  private concurrency: number = 5;
  private batchDelay: number = 2000; // 2 seconds between batches

  constructor(sqliteWriter: SQLiteWriter) {
    this.sqliteWriter = sqliteWriter;
  }

  /**
   * Reconcile all missing images
   */
  async reconcile(): Promise<MediaReconciliationResult> {
    console.log('\n[MediaReconciler] Starting media reconciliation...');

    const result: MediaReconciliationResult = {
      totalImages: 0,
      alreadyCaptured: 0,
      fetched: 0,
      failed: 0,
      skipped: 0,
    };

    // 1. Get all photo media from database
    const allMedia = this.getAllPhotoMedia();
    result.totalImages = allMedia.length;

    console.log(`[MediaReconciler] Found ${result.totalImages} images in database`);

    // 2. Filter to only missing images
    const missingMedia = allMedia.filter((media) => {
      if (this.sqliteWriter.hasMediaContent(media.mediaKey)) {
        result.alreadyCaptured++;
        return false;
      }
      return true;
    });

    console.log(
      `[MediaReconciler] ${result.alreadyCaptured} already captured, ${missingMedia.length} missing`
    );

    if (missingMedia.length === 0) {
      console.log('[MediaReconciler] No missing images to fetch');
      return result;
    }

    // 3. Convert URLs to large format
    const imagesToFetch = missingMedia.map((media) => ({
      mediaKey: media.mediaKey,
      url: this.convertToLargeUrl(media.url),
    }));

    // 4. Fetch in batches with rate limiting
    console.log(`[MediaReconciler] Fetching ${imagesToFetch.length} missing images...`);

    for (let i = 0; i < imagesToFetch.length; i += this.concurrency) {
      const batch = imagesToFetch.slice(i, i + this.concurrency);

      const batchResults = await Promise.allSettled(
        batch.map(({ mediaKey, url }) => this.fetchAndStoreImage(mediaKey, url))
      );

      // Count results
      for (const batchResult of batchResults) {
        if (batchResult.status === 'fulfilled') {
          if (batchResult.value === 'success') {
            result.fetched++;
          } else if (batchResult.value === 'skipped') {
            result.skipped++;
          }
        } else {
          result.failed++;
        }
      }

      // Progress update
      const processed = Math.min(i + this.concurrency, imagesToFetch.length);
      console.log(
        `[MediaReconciler] Progress: ${processed}/${imagesToFetch.length} (${result.fetched} fetched, ${result.failed} failed, ${result.skipped} skipped)`
      );

      // Rate limiting delay between batches
      if (i + this.concurrency < imagesToFetch.length) {
        await this.sleep(this.batchDelay);
      }
    }

    this.printReport(result);

    return result;
  }

  /**
   * Get all photo media from database
   */
  private getAllPhotoMedia(): MediaRecord[] {
    const db = this.sqliteWriter.getDb();
    const query = `
      SELECT mediaKey, url, type
      FROM media
      WHERE type = 'photo' AND url IS NOT NULL
    `;

    const rows = db.prepare(query).all() as MediaRecord[];
    return rows;
  }

  /**
   * Convert media URL to large format
   * Example: https://pbs.twimg.com/media/ABC123.jpg
   * Becomes: https://pbs.twimg.com/media/ABC123.jpg?format=jpg&name=large
   */
  private convertToLargeUrl(url: string): string {
    if (!url) return url;

    // Already has parameters
    if (url.includes('?')) {
      // Replace name parameter if exists
      if (url.includes('name=')) {
        return url.replace(/name=[^&]+/, 'name=large');
      }
      // Add name parameter
      return `${url}&name=large`;
    }

    // No parameters, need to add format and name
    const format = this.extractFormat(url);
    return `${url}?format=${format}&name=large`;
  }

  /**
   * Extract image format from URL
   */
  private extractFormat(url: string): string {
    const match = url.match(/\.(jpg|png|webp)/i);
    return match ? match[1].toLowerCase() : 'jpg';
  }

  /**
   * Fetch and store a single image
   */
  private async fetchAndStoreImage(
    mediaKey: string,
    url: string
  ): Promise<'success' | 'skipped'> {
    try {
      // Skip if URL is invalid
      if (!url || !url.startsWith('http')) {
        return 'skipped';
      }

      // Fetch image
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Get buffer
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Convert to base64
      const base64Data = buffer.toString('base64');

      // Get MIME type
      const contentType = response.headers.get('content-type') || 'image/jpeg';

      // Store in database
      this.sqliteWriter.writeMediaContent({
        mediaKey,
        base64Data,
        mimeType: contentType,
        sizeBytes: buffer.length,
        sourceUrl: url,
        captureMethod: 'reconcile',
      });

      return 'success';
    } catch (error) {
      throw new Error(
        `Failed to fetch ${url}: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Print reconciliation report
   */
  private printReport(result: MediaReconciliationResult): void {
    console.log('\n─────────────────────────────────────────');
    console.log('📸 Media Reconciliation Report');
    console.log('─────────────────────────────────────────');
    console.log(`Total images:      ${result.totalImages}`);
    console.log(`Already captured:  ${result.alreadyCaptured}`);
    console.log(`Fetched:           ${result.fetched}`);
    console.log(`Failed:            ${result.failed}`);
    console.log(`Skipped:           ${result.skipped}`);

    const finalCaptured = result.alreadyCaptured + result.fetched;
    const coverage =
      result.totalImages > 0 ? ((finalCaptured / result.totalImages) * 100).toFixed(1) : '100';

    console.log(`Coverage:          ${coverage}%`);

    if (result.failed > 0) {
      console.log(`Status:            ⚠️  ${result.failed} images failed to fetch`);
    } else {
      console.log(`Status:            ✅ All images captured`);
    }
    console.log('─────────────────────────────────────────\n');
  }
}
