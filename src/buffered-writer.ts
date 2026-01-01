/**
 * Buffered Writer for efficient async I/O
 * Replaces blocking appendFileSync with buffered async writes
 */

import { appendFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';

export class BufferedWriter {
  private buffers: Map<string, string[]> = new Map();
  private flushThreshold: number;
  private autoFlushInterval?: NodeJS.Timeout;

  constructor(flushThreshold: number = 100, autoFlushMs?: number) {
    this.flushThreshold = flushThreshold;

    // Optional auto-flush interval
    if (autoFlushMs) {
      this.autoFlushInterval = setInterval(() => {
        this.flushAll().catch(err => {
          console.error('[BufferedWriter] Auto-flush error:', err);
        });
      }, autoFlushMs);
    }
  }

  /**
   * Write data to buffer (will auto-flush when threshold reached)
   */
  async write(file: string, data: any): Promise<void> {
    if (!this.buffers.has(file)) {
      this.buffers.set(file, []);
    }

    const buffer = this.buffers.get(file)!;
    buffer.push(JSON.stringify(data));

    if (buffer.length >= this.flushThreshold) {
      await this.flush(file);
    }
  }

  /**
   * Flush a specific file's buffer
   */
  async flush(file: string): Promise<void> {
    const buffer = this.buffers.get(file);
    if (!buffer || buffer.length === 0) {
      return;
    }

    const content = buffer.join('\n') + '\n';

    try {
      await appendFile(file, content);
      buffer.length = 0; // Clear buffer
    } catch (error) {
      console.error(`[BufferedWriter] Error flushing ${file}:`, error);
      throw error;
    }
  }

  /**
   * Flush all buffers
   */
  async flushAll(): Promise<void> {
    const files = Array.from(this.buffers.keys());
    await Promise.all(files.map(file => this.flush(file)));
  }

  /**
   * Initialize output files (clear them)
   */
  async initializeFiles(files: string[]): Promise<void> {
    await Promise.all(
      files.map(file => writeFile(file, '').catch(err => {
        console.error(`[BufferedWriter] Error initializing ${file}:`, err);
      }))
    );
  }

  /**
   * Get buffer stats
   */
  getStats(): { file: string; buffered: number }[] {
    return Array.from(this.buffers.entries()).map(([file, buffer]) => ({
      file,
      buffered: buffer.length,
    }));
  }

  /**
   * Cleanup and flush on shutdown
   */
  async close(): Promise<void> {
    if (this.autoFlushInterval) {
      clearInterval(this.autoFlushInterval);
    }
    await this.flushAll();
  }
}
