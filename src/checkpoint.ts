/**
 * Checkpoint System for crash recovery
 * Allows resuming extraction from where it left off
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';

export interface CheckpointData {
  lastTweetId: string;
  tweetOrder: number;
  seenTweets: string[];
  seenUsers: string[];
  seenMedia: string[];
  seenMetrics: string[];
  timestamp: number;
  responseCount: number;
}

export class Checkpoint {
  private checkpointFile: string;
  private checkpointInterval: number;
  private lastCheckpointTime: number = 0;
  private minCheckpointIntervalMs = 30000; // Min 30s between checkpoints

  constructor(checkpointFile: string = 'out/.checkpoint.json', checkpointInterval: number = 100) {
    this.checkpointFile = checkpointFile;
    this.checkpointInterval = checkpointInterval;
  }

  /**
   * Save checkpoint data
   */
  save(data: CheckpointData): void {
    // Rate limit checkpoint writes
    const now = Date.now();
    if (now - this.lastCheckpointTime < this.minCheckpointIntervalMs) {
      return;
    }

    try {
      const checkpointData = {
        ...data,
        timestamp: now,
      };

      writeFileSync(this.checkpointFile, JSON.stringify(checkpointData, null, 2));
      this.lastCheckpointTime = now;

      console.log(`[Checkpoint] Saved at tweet ${data.tweetOrder} (${data.seenTweets.length} total)`);
    } catch (error) {
      console.error('[Checkpoint] Error saving:', error);
    }
  }

  /**
   * Load checkpoint data
   */
  load(): CheckpointData | null {
    if (!existsSync(this.checkpointFile)) {
      return null;
    }

    try {
      const content = readFileSync(this.checkpointFile, 'utf-8');
      const data = JSON.parse(content) as CheckpointData;

      const age = Date.now() - data.timestamp;
      const ageMinutes = Math.round(age / 1000 / 60);

      console.log(`[Checkpoint] Found checkpoint from ${ageMinutes} minutes ago`);
      console.log(`[Checkpoint] Last position: tweet ${data.tweetOrder}, ${data.seenTweets.length} total tweets`);

      return data;
    } catch (error) {
      console.error('[Checkpoint] Error loading:', error);
      return null;
    }
  }

  /**
   * Delete checkpoint file
   */
  clear(): void {
    if (existsSync(this.checkpointFile)) {
      try {
        unlinkSync(this.checkpointFile);
        console.log('[Checkpoint] Cleared');
      } catch (error) {
        console.error('[Checkpoint] Error clearing:', error);
      }
    }
  }

  /**
   * Check if should save checkpoint based on interval
   */
  shouldSave(currentCount: number): boolean {
    return currentCount % this.checkpointInterval === 0;
  }
}
