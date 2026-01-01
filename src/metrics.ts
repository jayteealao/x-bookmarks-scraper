/**
 * Metrics Collector for observability and progress tracking
 */

import { formatDuration } from './utils.js';

export interface MetricsSnapshot {
  tweetsProcessed: number;
  usersProcessed: number;
  mediaProcessed: number;
  responsesProcessed: number;
  parseErrors: number;
  tweetsPerSecond: number;
  estimatedTimeRemaining?: string;
  elapsedTime: string;
  memoryUsageMB: number;
}

export class MetricsCollector {
  private startTime: number = Date.now();
  private lastUpdateTime: number = Date.now();
  private lastPrintTime: number = 0;
  private printIntervalMs: number = 5000; // Print every 5 seconds

  // Counters
  private tweetsProcessed: number = 0;
  private usersProcessed: number = 0;
  private mediaProcessed: number = 0;
  private responsesProcessed: number = 0;
  private parseErrors: number = 0;
  private scrollCount: number = 0;

  // Rate tracking
  private recentTweetCounts: number[] = [];
  private rateWindow: number = 10; // Track last 10 updates

  recordTweet(): void {
    this.tweetsProcessed++;
  }

  recordUser(): void {
    this.usersProcessed++;
  }

  recordMedia(): void {
    this.mediaProcessed++;
  }

  recordResponse(): void {
    this.responsesProcessed++;
  }

  recordError(): void {
    this.parseErrors++;
  }

  recordScroll(): void {
    this.scrollCount++;
  }

  /**
   * Get current metrics snapshot
   */
  getSnapshot(): MetricsSnapshot {
    const now = Date.now();
    const elapsedMs = now - this.startTime;
    const elapsedSeconds = elapsedMs / 1000;

    // Calculate tweets per second
    const tweetsPerSecond = elapsedSeconds > 0 ? this.tweetsProcessed / elapsedSeconds : 0;

    // Get memory usage
    const memoryUsageMB = process.memoryUsage().heapUsed / 1024 / 1024;

    return {
      tweetsProcessed: this.tweetsProcessed,
      usersProcessed: this.usersProcessed,
      mediaProcessed: this.mediaProcessed,
      responsesProcessed: this.responsesProcessed,
      parseErrors: this.parseErrors,
      tweetsPerSecond,
      elapsedTime: formatDuration(elapsedMs),
      memoryUsageMB,
    };
  }

  /**
   * Update rate tracking and print progress if interval elapsed
   */
  update(autoprint: boolean = true): void {
    const now = Date.now();
    this.lastUpdateTime = now;

    // Update rate tracking
    this.recentTweetCounts.push(this.tweetsProcessed);
    if (this.recentTweetCounts.length > this.rateWindow) {
      this.recentTweetCounts.shift();
    }

    // Auto-print progress
    if (autoprint && now - this.lastPrintTime >= this.printIntervalMs) {
      this.printProgress();
      this.lastPrintTime = now;
    }
  }

  /**
   * Get current processing rate (tweets/sec) from recent window
   */
  getCurrentRate(): number {
    if (this.recentTweetCounts.length < 2) {
      return 0;
    }

    const first = this.recentTweetCounts[0];
    const last = this.recentTweetCounts[this.recentTweetCounts.length - 1];
    const tweetsDiff = last - first;
    const timeDiff = (this.recentTweetCounts.length - 1) * (this.printIntervalMs / 1000);

    return timeDiff > 0 ? tweetsDiff / timeDiff : 0;
  }

  /**
   * Estimate time remaining
   */
  estimateTimeRemaining(totalBookmarks: number): string | undefined {
    if (totalBookmarks <= this.tweetsProcessed) {
      return undefined;
    }

    const rate = this.getCurrentRate();
    if (rate <= 0) {
      return undefined;
    }

    const remaining = totalBookmarks - this.tweetsProcessed;
    const secondsRemaining = remaining / rate;
    return formatDuration(secondsRemaining * 1000);
  }

  /**
   * Print progress to console
   */
  printProgress(force: boolean = false): void {
    const now = Date.now();
    if (!force && now - this.lastPrintTime < this.printIntervalMs) {
      return;
    }

    const snapshot = this.getSnapshot();
    const currentRate = this.getCurrentRate();

    console.log('\n─────────────────────────────────────────');
    console.log(`📊 Progress Update (${snapshot.elapsedTime} elapsed)`);
    console.log(`─────────────────────────────────────────`);
    console.log(`Tweets:     ${snapshot.tweetsProcessed.toLocaleString()}`);
    console.log(`Users:      ${snapshot.usersProcessed.toLocaleString()}`);
    console.log(`Media:      ${snapshot.mediaProcessed.toLocaleString()}`);
    console.log(`Responses:  ${snapshot.responsesProcessed}`);
    console.log(`Scrolls:    ${this.scrollCount}`);
    console.log(`Errors:     ${snapshot.parseErrors}`);
    console.log(`Rate:       ${currentRate.toFixed(1)} tweets/sec (current)`);
    console.log(`            ${snapshot.tweetsPerSecond.toFixed(1)} tweets/sec (average)`);
    console.log(`Memory:     ${snapshot.memoryUsageMB.toFixed(1)} MB`);
    console.log(`─────────────────────────────────────────\n`);

    this.lastPrintTime = now;
  }

  /**
   * Print final summary
   */
  printSummary(): void {
    const snapshot = this.getSnapshot();

    console.log('\n═════════════════════════════════════════');
    console.log(`📈 Final Summary`);
    console.log(`═════════════════════════════════════════`);
    console.log(`Total Tweets:      ${snapshot.tweetsProcessed.toLocaleString()}`);
    console.log(`Total Users:       ${snapshot.usersProcessed.toLocaleString()}`);
    console.log(`Total Media:       ${snapshot.mediaProcessed.toLocaleString()}`);
    console.log(`Total Responses:   ${snapshot.responsesProcessed}`);
    console.log(`Total Scrolls:     ${this.scrollCount}`);
    console.log(`Parse Errors:      ${snapshot.parseErrors}`);
    console.log(`Average Rate:      ${snapshot.tweetsPerSecond.toFixed(1)} tweets/sec`);
    console.log(`Total Time:        ${snapshot.elapsedTime}`);
    console.log(`Peak Memory:       ${snapshot.memoryUsageMB.toFixed(1)} MB`);
    console.log(`═════════════════════════════════════════\n`);
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.startTime = Date.now();
    this.lastUpdateTime = Date.now();
    this.tweetsProcessed = 0;
    this.usersProcessed = 0;
    this.mediaProcessed = 0;
    this.responsesProcessed = 0;
    this.parseErrors = 0;
    this.scrollCount = 0;
    this.recentTweetCounts = [];
  }
}
