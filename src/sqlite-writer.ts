/**
 * SQLite Writer
 * Direct export to SQLite database instead of JSONL files
 */

import Database from 'better-sqlite3';
import type {
  TweetEntity,
  TwitterUserEntity,
  TweetPublicMetrics,
  TweetMediaEntity,
  TweetIncludesEntity,
  TweetTextEntityAnnotation,
  MediaKeys,
} from './types.js';

export class SQLiteWriter {
  private db: Database.Database;
  private statements: Map<string, Database.Statement> = new Map();

  constructor(dbPath: string = 'out/bookmarks.db') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL'); // Better concurrency
    this.db.pragma('synchronous = NORMAL'); // Faster writes
    this.createTables();
    this.prepareStatements();
  }

  /**
   * Create all tables
   */
  private createTables(): void {
    this.db.exec(`
      -- Tweets table
      CREATE TABLE IF NOT EXISTS tweets (
        tweetId TEXT PRIMARY KEY,
        authorId TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        text TEXT NOT NULL,
        conversationId TEXT,
        inReplyToUserId TEXT,
        lang TEXT,
        source TEXT,
        "order" INTEGER NOT NULL,
        FOREIGN KEY (authorId) REFERENCES users(userId)
      );

      CREATE INDEX IF NOT EXISTS idx_tweets_author ON tweets(authorId);
      CREATE INDEX IF NOT EXISTS idx_tweets_created ON tweets(createdAt);
      CREATE INDEX IF NOT EXISTS idx_tweets_order ON tweets("order");

      -- Users table
      CREATE TABLE IF NOT EXISTS users (
        userId TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        profileImageUrl TEXT,
        verified INTEGER DEFAULT 0,
        followersCount INTEGER,
        followingCount INTEGER,
        tweetCount INTEGER,
        listedCount INTEGER,
        createdAt TEXT,
        location TEXT,
        url TEXT,
        pinnedTweetId TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

      -- Metrics table
      CREATE TABLE IF NOT EXISTS metrics (
        tweetId TEXT PRIMARY KEY,
        retweetCount INTEGER NOT NULL DEFAULT 0,
        replyCount INTEGER NOT NULL DEFAULT 0,
        likeCount INTEGER NOT NULL DEFAULT 0,
        quoteCount INTEGER NOT NULL DEFAULT 0,
        bookmarkCount INTEGER,
        impressionCount INTEGER,
        FOREIGN KEY (tweetId) REFERENCES tweets(tweetId)
      );

      -- Media table
      CREATE TABLE IF NOT EXISTS media (
        mediaKey TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        url TEXT,
        previewImageUrl TEXT,
        width INTEGER,
        height INTEGER,
        durationMs INTEGER,
        altText TEXT
      );

      -- Media keys (tweet-media mapping)
      CREATE TABLE IF NOT EXISTS media_keys (
        mediaKey TEXT NOT NULL,
        tweetId TEXT NOT NULL,
        PRIMARY KEY (mediaKey, tweetId),
        FOREIGN KEY (mediaKey) REFERENCES media(mediaKey),
        FOREIGN KEY (tweetId) REFERENCES tweets(tweetId)
      );

      -- Includes (relationships)
      CREATE TABLE IF NOT EXISTS includes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tweetId TEXT NOT NULL,
        mediaKey TEXT,
        referencedTweetId TEXT,
        userId TEXT,
        FOREIGN KEY (tweetId) REFERENCES tweets(tweetId)
      );

      CREATE INDEX IF NOT EXISTS idx_includes_tweet ON includes(tweetId);
      CREATE INDEX IF NOT EXISTS idx_includes_media ON includes(mediaKey);
      CREATE INDEX IF NOT EXISTS idx_includes_ref_tweet ON includes(referencedTweetId);

      -- Text annotations
      CREATE TABLE IF NOT EXISTS text_annotations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tweetId TEXT NOT NULL,
        type TEXT NOT NULL,
        start INTEGER NOT NULL,
        "end" INTEGER NOT NULL,
        tag TEXT,
        url TEXT,
        expandedUrl TEXT,
        displayUrl TEXT,
        unwoundUrl TEXT,
        userId TEXT,
        username TEXT,
        FOREIGN KEY (tweetId) REFERENCES tweets(tweetId)
      );

      CREATE INDEX IF NOT EXISTS idx_annotations_tweet ON text_annotations(tweetId);
      CREATE INDEX IF NOT EXISTS idx_annotations_type ON text_annotations(type);
    `);
  }

  /**
   * Prepare all insert statements
   */
  private prepareStatements(): void {
    this.statements.set('tweet', this.db.prepare(`
      INSERT OR REPLACE INTO tweets (
        tweetId, authorId, createdAt, text, conversationId,
        inReplyToUserId, lang, source, "order"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `));

    this.statements.set('user', this.db.prepare(`
      INSERT OR REPLACE INTO users (
        userId, username, name, description, profileImageUrl,
        verified, followersCount, followingCount, tweetCount,
        listedCount, createdAt, location, url, pinnedTweetId
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `));

    this.statements.set('metrics', this.db.prepare(`
      INSERT OR REPLACE INTO metrics (
        tweetId, retweetCount, replyCount, likeCount,
        quoteCount, bookmarkCount, impressionCount
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `));

    this.statements.set('media', this.db.prepare(`
      INSERT OR REPLACE INTO media (
        mediaKey, type, url, previewImageUrl,
        width, height, durationMs, altText
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `));

    this.statements.set('mediaKey', this.db.prepare(`
      INSERT OR IGNORE INTO media_keys (mediaKey, tweetId)
      VALUES (?, ?)
    `));

    this.statements.set('include', this.db.prepare(`
      INSERT OR IGNORE INTO includes (
        tweetId, mediaKey, referencedTweetId, userId
      ) VALUES (?, ?, ?, ?)
    `));

    this.statements.set('annotation', this.db.prepare(`
      INSERT INTO text_annotations (
        tweetId, type, start, "end", tag, url,
        expandedUrl, displayUrl, unwoundUrl, userId, username
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `));
  }

  /**
   * Write tweet
   */
  writeTweet(tweet: TweetEntity): void {
    const stmt = this.statements.get('tweet')!;
    stmt.run(
      tweet.tweetId,
      tweet.authorId,
      tweet.createdAt,
      tweet.text,
      tweet.conversationId || null,
      tweet.inReplyToUserId || null,
      tweet.lang || null,
      tweet.source || null,
      tweet.order
    );
  }

  /**
   * Write user
   */
  writeUser(user: TwitterUserEntity): void {
    const stmt = this.statements.get('user')!;
    stmt.run(
      user.userId,
      user.username,
      user.name,
      user.description || null,
      user.profileImageUrl || null,
      user.verified ? 1 : 0,
      user.followersCount || null,
      user.followingCount || null,
      user.tweetCount || null,
      user.listedCount || null,
      user.createdAt || null,
      user.location || null,
      user.url || null,
      user.pinnedTweetId || null
    );
  }

  /**
   * Write metrics
   */
  writeMetrics(metrics: TweetPublicMetrics): void {
    const stmt = this.statements.get('metrics')!;
    stmt.run(
      metrics.tweetId,
      metrics.retweetCount,
      metrics.replyCount,
      metrics.likeCount,
      metrics.quoteCount,
      metrics.bookmarkCount || null,
      metrics.impressionCount || null
    );
  }

  /**
   * Write media
   */
  writeMedia(media: TweetMediaEntity): void {
    const stmt = this.statements.get('media')!;
    stmt.run(
      media.mediaKey,
      media.type,
      media.url || null,
      media.previewImageUrl || null,
      media.width || null,
      media.height || null,
      media.durationMs || null,
      media.altText || null
    );
  }

  /**
   * Write media key
   */
  writeMediaKey(mediaKey: MediaKeys): void {
    const stmt = this.statements.get('mediaKey')!;
    stmt.run(mediaKey.mediaKey, mediaKey.tweetId);
  }

  /**
   * Write include
   */
  writeInclude(include: TweetIncludesEntity): void {
    const stmt = this.statements.get('include')!;
    stmt.run(
      include.tweetId,
      include.mediaKey || null,
      include.referencedTweetId || null,
      include.userId || null
    );
  }

  /**
   * Write annotation
   */
  writeAnnotation(annotation: TweetTextEntityAnnotation): void {
    const stmt = this.statements.get('annotation')!;
    stmt.run(
      annotation.tweetId,
      annotation.type,
      annotation.start,
      annotation.end,
      annotation.tag || null,
      annotation.url || null,
      annotation.expandedUrl || null,
      annotation.displayUrl || null,
      annotation.unwoundUrl || null,
      annotation.userId || null,
      annotation.username || null
    );
  }

  /**
   * Begin transaction
   */
  beginTransaction(): void {
    this.db.prepare('BEGIN TRANSACTION').run();
  }

  /**
   * Commit transaction
   */
  commit(): void {
    this.db.prepare('COMMIT').run();
  }

  /**
   * Rollback transaction
   */
  rollback(): void {
    this.db.prepare('ROLLBACK').run();
  }

  /**
   * Get database stats
   */
  getStats(): {
    tweets: number;
    users: number;
    media: number;
    annotations: number;
  } {
    const tweets = this.db.prepare('SELECT COUNT(*) as count FROM tweets').get() as { count: number };
    const users = this.db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
    const media = this.db.prepare('SELECT COUNT(*) as count FROM media').get() as { count: number };
    const annotations = this.db.prepare('SELECT COUNT(*) as count FROM text_annotations').get() as { count: number };

    return {
      tweets: tweets.count,
      users: users.count,
      media: media.count,
      annotations: annotations.count,
    };
  }

  /**
   * Close database
   */
  close(): void {
    this.db.close();
  }
}
