/**
 * Mapper Module
 * Converts GraphQL JSON to Room entity rows with defensive parsing
 */

import { appendFileSync, writeFileSync, existsSync } from 'fs';
import type {
  TweetEntity,
  TwitterUserEntity,
  TweetPublicMetrics,
  TweetMediaEntity,
  TweetIncludesEntity,
  TweetTextEntityAnnotation,
  MediaKeys,
  ReferencedTweetsByTweet,
  ExtractionReport,
} from './types.js';

export class BookmarkMapper {
  private seenTweets = new Set<string>();
  private seenUsers = new Set<string>();
  private seenMedia = new Set<string>();
  private seenMetrics = new Set<string>();
  private seenIncludes = new Set<string>();
  private seenAnnotations = new Set<string>();

  private tweetOrder = 0;
  private responseCount = 0;
  private parseErrors: Array<{ url: string; error: string }> = [];

  private outputFiles = {
    tweets: 'out/tweetEntity.jsonl',
    users: 'out/twitterUser.jsonl',
    metrics: 'out/tweetPublicMetrics.jsonl',
    media: 'out/tweetMedia.jsonl',
    includes: 'out/tweetIncludes.jsonl',
    annotations: 'out/tweetTextEntityAnnotation.jsonl',
    mediaKeys: 'out/mediaKeys.jsonl',
    referencedTweets: 'out/referencedTweets_byTweet.jsonl',
  };

  constructor() {
    // Initialize output files (clear them)
    for (const file of Object.values(this.outputFiles)) {
      writeFileSync(file, '');
    }
  }

  /**
   * Process a GraphQL response and extract bookmark data
   */
  processResponse(url: string, json: any): void {
    this.responseCount++;

    try {
      const entries = this.extractTimelineEntries(json);

      if (entries.length === 0) {
        return; // Not a bookmark timeline response
      }

      console.log(`[Mapper] Processing ${entries.length} entries from response ${this.responseCount}`);

      for (const entry of entries) {
        try {
          this.processEntry(entry);
        } catch (error) {
          this.parseErrors.push({
            url,
            error: `Entry error: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
    } catch (error) {
      this.parseErrors.push({
        url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Extract timeline entries from GraphQL response
   * Tries multiple known paths
   */
  private extractTimelineEntries(json: any): any[] {
    if (!json || typeof json !== 'object') return [];

    // Try multiple paths based on X's GraphQL API structure
    const paths = [
      // Most common bookmark timeline path
      'data.bookmark_timeline_v2.timeline.instructions',
      // Alternative paths
      'data.bookmarks_timeline.timeline.instructions',
      'data.user.result.timeline_v2.timeline.instructions',
    ];

    for (const path of paths) {
      const instructions = this.getByPath(json, path);
      if (Array.isArray(instructions)) {
        // Extract entries from instructions
        const allEntries: any[] = [];

        for (const instruction of instructions) {
          if (instruction.type === 'TimelineAddEntries' && Array.isArray(instruction.entries)) {
            allEntries.push(...instruction.entries);
          } else if (instruction.entries && Array.isArray(instruction.entries)) {
            allEntries.push(...instruction.entries);
          }
        }

        if (allEntries.length > 0) {
          return allEntries;
        }
      }
    }

    return [];
  }

  /**
   * Get value by dot-notation path
   */
  private getByPath(obj: any, path: string): any {
    const parts = path.split('.');
    let current = obj;

    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  /**
   * Process a single timeline entry
   */
  private processEntry(entry: any): void {
    // Extract tweet result from entry
    const tweetResult = this.unwrapTweetResult(entry);

    if (!tweetResult) {
      return; // Not a tweet entry or tombstone
    }

    const tweetId = tweetResult.rest_id;
    if (!tweetId || this.seenTweets.has(tweetId)) {
      return; // Already processed
    }

    this.seenTweets.add(tweetId);
    this.tweetOrder++;

    // Process the main tweet
    this.processTweet(tweetResult, this.tweetOrder);

    // Process quoted/retweeted tweets if present
    if (tweetResult.quoted_status_result?.result) {
      this.processTweet(tweetResult.quoted_status_result.result, this.tweetOrder);
    }

    if (tweetResult.retweeted_status_result?.result) {
      this.processTweet(tweetResult.retweeted_status_result.result, this.tweetOrder);
    }
  }

  /**
   * Unwrap tweet result from various entry structures
   */
  private unwrapTweetResult(entry: any): any {
    if (!entry || typeof entry !== 'object') return null;

    // Try multiple paths to find the tweet result
    const paths = [
      'content.itemContent.tweet_results.result',
      'content.tweet.tweet_results.result',
      'item.content.tweet.tweet_results.result',
      'content.item.content.tweet.tweet_results.result',
    ];

    for (const path of paths) {
      const result = this.getByPath(entry, path);
      if (result && result.rest_id) {
        return result;
      }
    }

    // Check for tombstone
    if (entry.content?.itemContent?.tweetDisplayType === 'Tweet' &&
        entry.content?.itemContent?.tombstoneInfo) {
      return null; // Unavailable tweet
    }

    return null;
  }

  /**
   * Process a tweet and emit all related entities
   */
  private processTweet(tweetResult: any, order: number): void {
    const tweetId = tweetResult.rest_id;
    if (!tweetId) return;

    // Skip if already processed (can happen with retweets)
    if (this.seenTweets.has(tweetId)) return;
    this.seenTweets.add(tweetId);

    const legacy = tweetResult.legacy || {};
    const core = tweetResult.core || {};

    // Extract user
    const userResult = core.user_results?.result || tweetResult.user_results?.result;
    const authorId = userResult?.rest_id || legacy.user_id_str;

    if (!authorId) {
      console.warn(`[Mapper] Tweet ${tweetId} missing author ID`);
      return;
    }

    // Emit user
    if (userResult) {
      this.emitUser(userResult);
    }

    // Emit tweet
    const tweet: TweetEntity = {
      tweetId,
      authorId,
      createdAt: legacy.created_at || new Date().toISOString(),
      text: legacy.full_text || legacy.text || '',
      conversationId: legacy.conversation_id_str,
      inReplyToUserId: legacy.in_reply_to_user_id_str,
      lang: legacy.lang,
      source: this.extractSource(legacy.source),
      order,
    };
    this.emitTweet(tweet);

    // Emit metrics
    const metrics: TweetPublicMetrics = {
      tweetId,
      retweetCount: legacy.retweet_count || 0,
      replyCount: legacy.reply_count || 0,
      likeCount: legacy.favorite_count || 0,
      quoteCount: legacy.quote_count || 0,
      bookmarkCount: legacy.bookmark_count,
    };
    this.emitMetrics(metrics);

    // Emit media
    if (legacy.entities?.media || legacy.extended_entities?.media) {
      const mediaList = legacy.extended_entities?.media || legacy.entities?.media || [];
      for (const media of mediaList) {
        this.emitMedia(media, tweetId);
      }
    }

    // Emit text annotations (URLs, hashtags, mentions, etc.)
    if (legacy.entities) {
      this.emitTextAnnotations(tweetId, legacy.entities);
    }

    // Emit referenced tweets
    this.emitReferencedTweets(tweetId, legacy, tweetResult);
  }

  /**
   * Emit user entity
   */
  private emitUser(userResult: any): void {
    const userId = userResult.rest_id;
    if (!userId || this.seenUsers.has(userId)) return;
    this.seenUsers.add(userId);

    const legacy = userResult.legacy || {};

    const user: TwitterUserEntity = {
      userId,
      username: legacy.screen_name || '',
      name: legacy.name || '',
      description: legacy.description,
      profileImageUrl: legacy.profile_image_url_https || legacy.profile_image_url,
      verified: legacy.verified || userResult.is_blue_verified || false,
      followersCount: legacy.followers_count,
      followingCount: legacy.friends_count,
      tweetCount: legacy.statuses_count,
      listedCount: legacy.listed_count,
      createdAt: legacy.created_at,
      location: legacy.location,
      url: legacy.url,
      pinnedTweetId: legacy.pinned_tweet_ids_str?.[0],
    };

    appendFileSync(this.outputFiles.users, JSON.stringify(user) + '\n');
  }

  /**
   * Emit tweet entity
   */
  private emitTweet(tweet: TweetEntity): void {
    appendFileSync(this.outputFiles.tweets, JSON.stringify(tweet) + '\n');
  }

  /**
   * Emit metrics entity
   */
  private emitMetrics(metrics: TweetPublicMetrics): void {
    if (this.seenMetrics.has(metrics.tweetId)) return;
    this.seenMetrics.add(metrics.tweetId);

    appendFileSync(this.outputFiles.metrics, JSON.stringify(metrics) + '\n');
  }

  /**
   * Emit media entity and media key
   */
  private emitMedia(media: any, tweetId: string): void {
    const mediaKey = media.id_str || media.media_key;
    if (!mediaKey || this.seenMedia.has(mediaKey)) return;
    this.seenMedia.add(mediaKey);

    const mediaEntity: TweetMediaEntity = {
      mediaKey,
      type: media.type,
      url: media.media_url_https || media.url,
      previewImageUrl: media.media_url_https,
      width: media.original_info?.width || media.sizes?.large?.w,
      height: media.original_info?.height || media.sizes?.large?.h,
      durationMs: media.video_info?.duration_millis,
      altText: media.ext_alt_text,
    };

    appendFileSync(this.outputFiles.media, JSON.stringify(mediaEntity) + '\n');

    // Emit media key
    const mediaKeyEntity: MediaKeys = { mediaKey, tweetId };
    appendFileSync(this.outputFiles.mediaKeys, JSON.stringify(mediaKeyEntity) + '\n');

    // Emit include for media
    const includeKey = `${tweetId}:media:${mediaKey}`;
    if (!this.seenIncludes.has(includeKey)) {
      this.seenIncludes.add(includeKey);
      const include: TweetIncludesEntity = { tweetId, mediaKey };
      appendFileSync(this.outputFiles.includes, JSON.stringify(include) + '\n');
    }
  }

  /**
   * Emit text annotations (URLs, hashtags, mentions, symbols)
   */
  private emitTextAnnotations(tweetId: string, entities: any): void {
    // URLs
    if (Array.isArray(entities.urls)) {
      for (const urlEntity of entities.urls) {
        const key = `${tweetId}:url:${urlEntity.indices?.[0] || 0}`;
        if (this.seenAnnotations.has(key)) continue;
        this.seenAnnotations.add(key);

        const annotation: TweetTextEntityAnnotation = {
          tweetId,
          type: 'url',
          start: urlEntity.indices?.[0] || 0,
          end: urlEntity.indices?.[1] || 0,
          url: urlEntity.url,
          expandedUrl: urlEntity.expanded_url,
          displayUrl: urlEntity.display_url,
          unwoundUrl: urlEntity.unwound_url,
        };
        appendFileSync(this.outputFiles.annotations, JSON.stringify(annotation) + '\n');
      }
    }

    // Hashtags
    if (Array.isArray(entities.hashtags)) {
      for (const hashtag of entities.hashtags) {
        const key = `${tweetId}:hashtag:${hashtag.indices?.[0] || 0}`;
        if (this.seenAnnotations.has(key)) continue;
        this.seenAnnotations.add(key);

        const annotation: TweetTextEntityAnnotation = {
          tweetId,
          type: 'hashtag',
          start: hashtag.indices?.[0] || 0,
          end: hashtag.indices?.[1] || 0,
          tag: hashtag.text,
        };
        appendFileSync(this.outputFiles.annotations, JSON.stringify(annotation) + '\n');
      }
    }

    // Mentions
    if (Array.isArray(entities.user_mentions)) {
      for (const mention of entities.user_mentions) {
        const key = `${tweetId}:mention:${mention.indices?.[0] || 0}`;
        if (this.seenAnnotations.has(key)) continue;
        this.seenAnnotations.add(key);

        const annotation: TweetTextEntityAnnotation = {
          tweetId,
          type: 'mention',
          start: mention.indices?.[0] || 0,
          end: mention.indices?.[1] || 0,
          username: mention.screen_name,
          userId: mention.id_str,
        };
        appendFileSync(this.outputFiles.annotations, JSON.stringify(annotation) + '\n');

        // Also emit include for mention if we have userId
        if (mention.id_str) {
          const includeKey = `${tweetId}:user:${mention.id_str}`;
          if (!this.seenIncludes.has(includeKey)) {
            this.seenIncludes.add(includeKey);
            const include: TweetIncludesEntity = { tweetId, userId: mention.id_str };
            appendFileSync(this.outputFiles.includes, JSON.stringify(include) + '\n');
          }
        }
      }
    }

    // Symbols (cashtags)
    if (Array.isArray(entities.symbols)) {
      for (const symbol of entities.symbols) {
        const key = `${tweetId}:cashtag:${symbol.indices?.[0] || 0}`;
        if (this.seenAnnotations.has(key)) continue;
        this.seenAnnotations.add(key);

        const annotation: TweetTextEntityAnnotation = {
          tweetId,
          type: 'cashtag',
          start: symbol.indices?.[0] || 0,
          end: symbol.indices?.[1] || 0,
          tag: symbol.text,
        };
        appendFileSync(this.outputFiles.annotations, JSON.stringify(annotation) + '\n');
      }
    }
  }

  /**
   * Emit referenced tweets (replies, quotes, retweets)
   */
  private emitReferencedTweets(tweetId: string, legacy: any, tweetResult: any): void {
    const refs: Array<{ type: string; id: string }> = [];

    // Reply
    if (legacy.in_reply_to_status_id_str) {
      refs.push({ type: 'replied_to', id: legacy.in_reply_to_status_id_str });

      const includeKey = `${tweetId}:ref:${legacy.in_reply_to_status_id_str}`;
      if (!this.seenIncludes.has(includeKey)) {
        this.seenIncludes.add(includeKey);
        const include: TweetIncludesEntity = {
          tweetId,
          referencedTweetId: legacy.in_reply_to_status_id_str,
        };
        appendFileSync(this.outputFiles.includes, JSON.stringify(include) + '\n');
      }
    }

    // Quote
    if (legacy.quoted_status_id_str) {
      refs.push({ type: 'quoted', id: legacy.quoted_status_id_str });

      const includeKey = `${tweetId}:ref:${legacy.quoted_status_id_str}`;
      if (!this.seenIncludes.has(includeKey)) {
        this.seenIncludes.add(includeKey);
        const include: TweetIncludesEntity = {
          tweetId,
          referencedTweetId: legacy.quoted_status_id_str,
        };
        appendFileSync(this.outputFiles.includes, JSON.stringify(include) + '\n');
      }
    }

    // Retweet
    if (legacy.retweeted_status_id_str) {
      refs.push({ type: 'retweeted', id: legacy.retweeted_status_id_str });

      const includeKey = `${tweetId}:ref:${legacy.retweeted_status_id_str}`;
      if (!this.seenIncludes.has(includeKey)) {
        this.seenIncludes.add(includeKey);
        const include: TweetIncludesEntity = {
          tweetId,
          referencedTweetId: legacy.retweeted_status_id_str,
        };
        appendFileSync(this.outputFiles.includes, JSON.stringify(include) + '\n');
      }
    }

    if (refs.length > 0) {
      const refEntity: ReferencedTweetsByTweet = { tweetId, refs };
      appendFileSync(this.outputFiles.referencedTweets, JSON.stringify(refEntity) + '\n');
    }
  }

  /**
   * Extract source name from HTML anchor tag
   */
  private extractSource(source?: string): string | undefined {
    if (!source) return undefined;

    // Source is often like '<a href="..." rel="nofollow">Twitter Web App</a>'
    const match = source.match(/>([^<]+)</);
    return match ? match[1] : source;
  }

  /**
   * Generate extraction report
   */
  generateReport(): ExtractionReport {
    const report: ExtractionReport = {
      timestamp: new Date().toISOString(),
      totalGraphQLResponses: this.responseCount,
      uniqueTweets: this.seenTweets.size,
      uniqueUsers: this.seenUsers.size,
      uniqueMedia: this.seenMedia.size,
      totalIncludes: this.seenIncludes.size,
      totalAnnotations: this.seenAnnotations.size,
      totalMetrics: this.seenMetrics.size,
      parseErrors: this.parseErrors.length,
      sampleErrors: this.parseErrors.slice(0, 10),
    };

    writeFileSync('out/report.json', JSON.stringify(report, null, 2));

    console.log('\n=== Extraction Report ===');
    console.log(`Total GraphQL responses: ${report.totalGraphQLResponses}`);
    console.log(`Unique tweets: ${report.uniqueTweets}`);
    console.log(`Unique users: ${report.uniqueUsers}`);
    console.log(`Unique media: ${report.uniqueMedia}`);
    console.log(`Total includes: ${report.totalIncludes}`);
    console.log(`Total annotations: ${report.totalAnnotations}`);
    console.log(`Parse errors: ${report.parseErrors}`);

    if (report.parseErrors > 0) {
      console.log('\nSample errors:');
      report.sampleErrors.forEach(err => {
        console.log(`  ${err.url}: ${err.error}`);
      });
    }

    return report;
  }
}
