/**
 * HAR Reconciler
 * Validates extraction against HAR file and fills in any missed data
 * Runs automatically after each extraction completes
 */

import { createReadStream, existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { createUnzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { Writable } from 'stream';

export interface ReconciliationResult {
  harResponseCount: number;
  liveResponseCount: number;
  tweetsInHar: number;
  tweetsExtracted: number;
  recovered: {
    tweets: number;
    users: number;
    media: number;
  };
  missingTweetIds: string[];
  status: 'complete' | 'recovered' | 'gap_detected';
}

export class HarReconciler {
  private harPath: string;

  constructor(harPath: string = 'out/x-bookmarks.har.zip') {
    this.harPath = harPath;
  }

  /**
   * Extract and parse the HAR file
   */
  async parseHar(): Promise<any> {
    if (!existsSync(this.harPath)) {
      throw new Error(`HAR file not found: ${this.harPath}`);
    }

    // For zip files, we need to extract har.har from the archive
    if (this.harPath.endsWith('.zip')) {
      return this.parseZippedHar();
    }

    const content = await readFile(this.harPath, 'utf-8');
    return JSON.parse(content);
  }

  /**
   * Parse zipped HAR file
   */
  private async parseZippedHar(): Promise<any> {
    const content = await this.extractHarContent();
    return JSON.parse(content);
  }

  /**
   * Extract HAR content from zip using platform-appropriate method
   */
  private async extractHarContent(): Promise<string> {
    const { execSync } = await import('child_process');
    const path = await import('path');
    const os = await import('os');

    // Try unzip first (Linux/Mac/Git Bash on Windows)
    try {
      const result = execSync(`unzip -p "${this.harPath}" har.har`, {
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024
      });
      return result;
    } catch {
      // unzip not available, try PowerShell (Windows)
    }

    // Try PowerShell Expand-Archive (Windows native)
    try {
      const tempDir = path.join(os.tmpdir(), `har-extract-${Date.now()}`);
      const harFile = path.join(tempDir, 'har.har');

      // Use PowerShell to extract
      execSync(
        `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${this.harPath}' -DestinationPath '${tempDir}' -Force"`,
        { encoding: 'utf-8', stdio: 'pipe' }
      );

      // Read the extracted file
      const content = await readFile(harFile, 'utf-8');

      // Cleanup
      try {
        const fs = await import('fs');
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }

      return content;
    } catch (e) {
      throw new Error(`Could not extract HAR zip. Error: ${e instanceof Error ? e.message : e}`);
    }
  }

  /**
   * Extract all bookmark entries from HAR
   */
  async extractEntriesFromHar(): Promise<Map<string, any>> {
    const har = await this.parseHar();
    const tweetMap = new Map<string, any>();

    for (const entry of har.log.entries) {
      const url = entry.request.url;

      // Only process Bookmarks API responses
      if (!url.includes('/graphql/') || !url.includes('Bookmarks')) {
        continue;
      }

      try {
        // Get response content
        let responseText = entry.response.content?.text;

        if (!responseText) {
          // Check if content is in a separate file (Playwright HAR format)
          const contentFile = entry.response.content?._file;
          if (contentFile) {
            // Content is stored separately - we'd need to extract it
            continue;
          }
          continue;
        }

        // Decompress if needed
        if (entry.response.content?.encoding === 'base64') {
          responseText = Buffer.from(responseText, 'base64').toString('utf-8');
        }

        const json = JSON.parse(responseText);
        const tweets = this.extractTweetsFromResponse(json);

        for (const tweet of tweets) {
          if (tweet.tweetId && !tweetMap.has(tweet.tweetId)) {
            tweetMap.set(tweet.tweetId, tweet);
          }
        }
      } catch (error) {
        // Skip malformed entries
        continue;
      }
    }

    return tweetMap;
  }

  /**
   * Extract tweets from a GraphQL response
   */
  private extractTweetsFromResponse(json: any): any[] {
    const tweets: any[] = [];

    const entries = this.findTimelineEntries(json);

    for (const entry of entries) {
      const tweet = this.extractTweetFromEntry(entry);
      if (tweet) {
        tweets.push(tweet);
      }
    }

    return tweets;
  }

  /**
   * Find timeline entries in response
   */
  private findTimelineEntries(json: any): any[] {
    const paths = [
      ['data', 'bookmark_timeline_v2', 'timeline', 'instructions'],
      ['data', 'bookmark_timeline', 'timeline', 'instructions'],
    ];

    for (const path of paths) {
      let current = json;
      for (const key of path) {
        current = current?.[key];
        if (!current) break;
      }

      if (Array.isArray(current)) {
        for (const instruction of current) {
          if (instruction.type === 'TimelineAddEntries' && instruction.entries) {
            return instruction.entries;
          }
        }
      }
    }

    return [];
  }

  /**
   * Extract tweet data from an entry
   */
  private extractTweetFromEntry(entry: any): any | null {
    try {
      const content = entry?.content;
      if (!content) return null;

      // Handle tweet entries
      if (content.entryType === 'TimelineTimelineItem' || content.__typename === 'TimelineTimelineItem') {
        const itemContent = content.itemContent;
        if (!itemContent) return null;

        const tweetResult = itemContent.tweet_results?.result;
        if (!tweetResult) return null;

        // Handle tombstones
        if (tweetResult.__typename === 'TweetTombstone') {
          return null;
        }

        // Handle TweetWithVisibilityResults wrapper
        const tweet = tweetResult.__typename === 'TweetWithVisibilityResults'
          ? tweetResult.tweet
          : tweetResult;

        if (!tweet?.legacy) return null;

        const legacy = tweet.legacy;
        const core = tweet.core?.user_results?.result;

        return {
          tweetId: legacy.id_str || tweet.rest_id,
          authorId: core?.rest_id || legacy.user_id_str,
          text: legacy.full_text,
          createdAt: legacy.created_at,
          conversationId: legacy.conversation_id_str,
          lang: legacy.lang,
          // Include user data if available
          user: core?.legacy ? {
            userId: core.rest_id,
            username: core.legacy.screen_name,
            displayName: core.legacy.name,
            description: core.legacy.description,
            profileImageUrl: core.legacy.profile_image_url_https,
            followersCount: core.legacy.followers_count,
            followingCount: core.legacy.friends_count,
          } : null,
          // Include metrics
          metrics: {
            likeCount: legacy.favorite_count,
            retweetCount: legacy.retweet_count,
            replyCount: legacy.reply_count,
            quoteCount: legacy.quote_count,
            bookmarkCount: legacy.bookmark_count,
          },
          // Include media
          media: legacy.extended_entities?.media || legacy.entities?.media || [],
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Reconcile extracted data against HAR
   */
  async reconcile(
    extractedTweetIds: Set<string>,
    liveResponseCount: number,
    onRecoverTweet?: (tweet: any) => Promise<void>
  ): Promise<ReconciliationResult> {
    console.log('\n[HAR Reconciler] Validating extraction against HAR file...');

    const harTweets = await this.extractEntriesFromHar();
    const harTweetIds = new Set(harTweets.keys());

    // Find missing tweets
    const missingTweetIds: string[] = [];
    for (const tweetId of harTweetIds) {
      if (!extractedTweetIds.has(tweetId)) {
        missingTweetIds.push(tweetId);
      }
    }

    let recovered = { tweets: 0, users: 0, media: 0 };

    // Recover missing tweets if callback provided
    if (onRecoverTweet && missingTweetIds.length > 0) {
      console.log(`[HAR Reconciler] Recovering ${missingTweetIds.length} missed tweets...`);

      for (const tweetId of missingTweetIds) {
        const tweet = harTweets.get(tweetId);
        if (tweet) {
          try {
            await onRecoverTweet(tweet);
            recovered.tweets++;
            if (tweet.user) recovered.users++;
            if (tweet.media?.length > 0) recovered.media++;
          } catch (error) {
            console.error(`[HAR Reconciler] Failed to recover tweet ${tweetId}:`, error);
          }
        }
      }
    }

    const result: ReconciliationResult = {
      harResponseCount: harTweets.size > 0 ? Math.ceil(harTweets.size / 20) : 0, // Estimate
      liveResponseCount,
      tweetsInHar: harTweetIds.size,
      tweetsExtracted: extractedTweetIds.size,
      recovered,
      missingTweetIds: missingTweetIds.slice(0, 100), // Limit for reporting
      status: missingTweetIds.length === 0
        ? 'complete'
        : recovered.tweets > 0
          ? 'recovered'
          : 'gap_detected',
    };

    this.printReport(result);

    return result;
  }

  /**
   * Print reconciliation report
   */
  private printReport(result: ReconciliationResult): void {
    console.log('\n─────────────────────────────────────────');
    console.log('📋 HAR Reconciliation Report');
    console.log('─────────────────────────────────────────');
    console.log(`Tweets in HAR:     ${result.tweetsInHar}`);
    console.log(`Tweets extracted:  ${result.tweetsExtracted}`);

    if (result.recovered.tweets > 0) {
      console.log(`Tweets recovered:  ${result.recovered.tweets}`);
      console.log(`Users recovered:   ${result.recovered.users}`);
      console.log(`Media recovered:   ${result.recovered.media}`);
    }

    const coverage = result.tweetsInHar > 0
      ? ((result.tweetsExtracted + result.recovered.tweets) / result.tweetsInHar * 100).toFixed(1)
      : '100';

    console.log(`Coverage:          ${coverage}%`);

    if (result.status === 'complete') {
      console.log(`Status:            ✅ Complete - all HAR data extracted`);
    } else if (result.status === 'recovered') {
      console.log(`Status:            🔄 Recovered - missing data filled from HAR`);
    } else {
      console.log(`Status:            ⚠️  Gap detected - ${result.missingTweetIds.length} tweets not recovered`);
    }
    console.log('─────────────────────────────────────────\n');
  }
}
