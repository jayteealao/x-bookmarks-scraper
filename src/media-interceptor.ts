/**
 * Media Interceptor
 * Captures images from network responses during bookmark scrolling
 * Stores base64-encoded images in SQLite database
 */

import type { Response } from 'playwright';
import type { SQLiteWriter } from './sqlite-writer.js';

export class MediaInterceptor {
  private sqliteWriter: SQLiteWriter;
  private seenMediaKeys = new Set<string>();
  private imageUrlPattern = /pbs\.twimg\.com\/media\/([^?]+).*name=large/;
  private captureCount = 0;
  private enabled: boolean;

  constructor(sqliteWriter: SQLiteWriter, enabled: boolean = true) {
    this.sqliteWriter = sqliteWriter;
    this.enabled = enabled;
  }

  /**
   * Handle a Playwright response
   * Called by context.on('response') event
   */
  async handleResponse(response: Response): Promise<void> {
    if (!this.enabled) return;

    // 1. Filter: Is this a large image?
    if (!this.isLargeImage(response.url())) return;

    // 2. Extract mediaKey from URL
    const mediaKey = this.extractMediaKey(response.url());
    if (!mediaKey) return;

    // 3. Dedup: Already captured in this session?
    if (this.seenMediaKeys.has(mediaKey)) return;

    // 4. Dedup: Already in database?
    if (this.sqliteWriter.hasMediaContent(mediaKey)) {
      this.seenMediaKeys.add(mediaKey);
      return;
    }

    // 5. Capture async (don't block scrolling)
    this.captureImage(response, mediaKey).catch((err) => {
      console.warn(`[MediaInterceptor] Failed to capture ${mediaKey}:`, err.message);
    });
  }

  /**
   * Check if URL is a large Twitter image
   */
  private isLargeImage(url: string): boolean {
    // Must be from pbs.twimg.com
    if (!url.includes('pbs.twimg.com/media/')) return false;

    // Must have name=large parameter
    if (!url.includes('name=large')) return false;

    // Must be a photo (jpg, png, webp)
    if (!url.match(/format=(jpg|png|webp)/)) return false;

    return true;
  }

  /**
   * Extract mediaKey from Twitter image URL
   * Example: https://pbs.twimg.com/media/ABC123xyz.jpg?format=jpg&name=large
   * Returns: "3_ABC123xyz" (media_keys are like "3_1234567890")
   */
  private extractMediaKey(url: string): string | null {
    const match = url.match(this.imageUrlPattern);
    if (!match) return null;

    // Extract the filename portion (e.g., "ABC123xyz")
    const filename = match[1];

    // Twitter media keys are like "3_1234567890" or "16_1234567890"
    // The URL filename is the part after the underscore
    // We need to reconstruct the full mediaKey by finding it in the media table
    // For now, we'll use the filename as a unique identifier
    // The reconciler will need to map these properly

    return filename;
  }

  /**
   * Capture image and store in database
   */
  private async captureImage(response: Response, mediaKey: string): Promise<void> {
    try {
      // Get response buffer
      const buffer = await response.body();

      // Convert to base64
      const base64Data = buffer.toString('base64');

      // Get MIME type from response headers
      const contentType = response.headers()['content-type'] || 'image/jpeg';

      // Get size in bytes
      const sizeBytes = buffer.length;

      // Store in database
      this.sqliteWriter.writeMediaContent({
        mediaKey,
        base64Data,
        mimeType: contentType,
        sizeBytes,
        sourceUrl: response.url(),
        captureMethod: 'intercept',
      });

      // Mark as seen
      this.seenMediaKeys.add(mediaKey);
      this.captureCount++;

      if (this.captureCount % 10 === 0) {
        console.log(`[MediaInterceptor] Captured ${this.captureCount} images`);
      }
    } catch (error) {
      throw new Error(
        `Failed to capture image: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  /**
   * Get capture statistics
   */
  getStats(): { captured: number } {
    return {
      captured: this.captureCount,
    };
  }

  /**
   * Enable/disable interception
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
}
