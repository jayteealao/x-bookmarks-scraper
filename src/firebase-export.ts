#!/usr/bin/env node
/**
 * Firebase Export Script
 * Migrates SQLite bookmarks database to Firestore
 *
 * Usage:
 *   npm run firebase:export
 *   npm run firebase:export -- --project=crumbs --dry-run
 */

import { initializeApp, cert, type ServiceAccount } from 'firebase-admin/app';
import { getFirestore, type Firestore, WriteBatch } from 'firebase-admin/firestore';
import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { readFileSync } from 'fs';

interface ExportOptions {
  dbPath: string;
  projectId: string;
  serviceAccountPath?: string;
  dryRun: boolean;
  batchSize: number;
  includeMedia: boolean;
}

interface ExportStats {
  tweets: number;
  users: number;
  metrics: number;
  media: number;
  mediaContent: number;
  annotations: number;
  includes: number;
  mediaKeys: number;
  batches: number;
  errors: number;
}

class FirebaseExporter {
  private db: Database.Database;
  private firestore?: Firestore;
  private options: ExportOptions;
  private stats: ExportStats = {
    tweets: 0,
    users: 0,
    metrics: 0,
    media: 0,
    mediaContent: 0,
    annotations: 0,
    includes: 0,
    mediaKeys: 0,
    batches: 0,
    errors: 0,
  };

  constructor(options: ExportOptions) {
    this.options = options;
    this.db = new Database(options.dbPath, { readonly: true });

    if (!options.dryRun) {
      this.initializeFirebase();
    }
  }

  /**
   * Initialize Firebase Admin SDK
   */
  private initializeFirebase(): void {
    console.log(`[Firebase] Initializing Firebase Admin SDK...`);
    console.log(`[Firebase] Project ID: ${this.options.projectId}`);

    try {
      let app;

      if (this.options.serviceAccountPath && existsSync(this.options.serviceAccountPath)) {
        // Use service account file
        const serviceAccount = JSON.parse(
          readFileSync(this.options.serviceAccountPath, 'utf-8')
        ) as ServiceAccount;

        app = initializeApp({
          credential: cert(serviceAccount),
          projectId: this.options.projectId,
        });
      } else {
        // Use default credentials (from environment)
        app = initializeApp({
          projectId: this.options.projectId,
        });
      }

      this.firestore = getFirestore(app);
      console.log(`[Firebase] ✓ Connected to Firestore`);
    } catch (error) {
      console.error(`[Firebase] Failed to initialize:`, error);
      throw error;
    }
  }

  /**
   * Export all data to Firestore
   */
  async export(): Promise<void> {
    console.log('\n╔═══════════════════════════════════════════╗');
    console.log('║   Firebase Export - SQLite → Firestore    ║');
    console.log('╚═══════════════════════════════════════════╝');
    console.log(`Source: ${this.options.dbPath}`);
    console.log(`Project: ${this.options.projectId}`);
    console.log(`Dry Run: ${this.options.dryRun ? 'YES (no writes)' : 'NO'}`);
    console.log(`Include Media: ${this.options.includeMedia ? 'YES' : 'NO (base64 images skipped)'}\n`);

    const startTime = Date.now();

    try {
      // Export in order (users first, then tweets that reference them, etc.)
      await this.exportUsers();
      await this.exportTweets();
      await this.exportMetrics();
      await this.exportMedia();
      await this.exportMediaKeys();
      await this.exportIncludes();
      await this.exportAnnotations();

      if (this.options.includeMedia) {
        await this.exportMediaContent();
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      this.printSummary(duration);
    } catch (error) {
      console.error('\n❌ Export failed:', error);
      throw error;
    } finally {
      this.db.close();
    }
  }

  /**
   * Export users collection
   */
  private async exportUsers(): Promise<void> {
    console.log('[1/8] Exporting users...');

    const users = this.db.prepare(`
      SELECT * FROM users
    `).all() as any[];

    await this.writeBatch('users', users, (user) => ({
      userId: user.userId,
      username: user.username,
      name: user.name,
      description: user.description || null,
      profileImageUrl: user.profileImageUrl || null,
      verified: user.verified === 1,
      followersCount: user.followersCount || 0,
      followingCount: user.followingCount || 0,
      tweetCount: user.tweetCount || 0,
      listedCount: user.listedCount || 0,
      createdAt: user.createdAt || null,
      location: user.location || null,
      url: user.url || null,
      pinnedTweetId: user.pinnedTweetId || null,
    }));

    this.stats.users = users.length;
    console.log(`  ✓ ${users.length} users exported`);
  }

  /**
   * Export tweets collection
   */
  private async exportTweets(): Promise<void> {
    console.log('[2/8] Exporting tweets...');

    const tweets = this.db.prepare(`
      SELECT * FROM tweets ORDER BY "order"
    `).all() as any[];

    await this.writeBatch('tweets', tweets, (tweet) => ({
      tweetId: tweet.tweetId,
      authorId: tweet.authorId,
      createdAt: tweet.createdAt,
      text: tweet.text,
      conversationId: tweet.conversationId || null,
      inReplyToUserId: tweet.inReplyToUserId || null,
      lang: tweet.lang || null,
      source: tweet.source || null,
      order: tweet.order,
    }));

    this.stats.tweets = tweets.length;
    console.log(`  ✓ ${tweets.length} tweets exported`);
  }

  /**
   * Export metrics collection
   */
  private async exportMetrics(): Promise<void> {
    console.log('[3/8] Exporting metrics...');

    const metrics = this.db.prepare(`
      SELECT * FROM metrics
    `).all() as any[];

    await this.writeBatch('metrics', metrics, (metric) => ({
      tweetId: metric.tweetId,
      retweetCount: metric.retweetCount || 0,
      replyCount: metric.replyCount || 0,
      likeCount: metric.likeCount || 0,
      quoteCount: metric.quoteCount || 0,
      bookmarkCount: metric.bookmarkCount || null,
      impressionCount: metric.impressionCount || null,
    }));

    this.stats.metrics = metrics.length;
    console.log(`  ✓ ${metrics.length} metrics exported`);
  }

  /**
   * Export media collection
   */
  private async exportMedia(): Promise<void> {
    console.log('[4/8] Exporting media...');

    const media = this.db.prepare(`
      SELECT * FROM media
    `).all() as any[];

    await this.writeBatch('media', media, (m) => ({
      mediaKey: m.mediaKey,
      type: m.type,
      url: m.url || null,
      previewImageUrl: m.previewImageUrl || null,
      width: m.width || null,
      height: m.height || null,
      durationMs: m.durationMs || null,
      altText: m.altText || null,
    }));

    this.stats.media = media.length;
    console.log(`  ✓ ${media.length} media records exported`);
  }

  /**
   * Export media_keys collection
   */
  private async exportMediaKeys(): Promise<void> {
    console.log('[5/8] Exporting media keys...');

    const mediaKeys = this.db.prepare(`
      SELECT * FROM media_keys
    `).all() as any[];

    await this.writeBatch('mediaKeys', mediaKeys, (mk) => ({
      mediaKey: mk.mediaKey,
      tweetId: mk.tweetId,
    }), (mk) => `${mk.tweetId}_${mk.mediaKey}`);

    this.stats.mediaKeys = mediaKeys.length;
    console.log(`  ✓ ${mediaKeys.length} media keys exported`);
  }

  /**
   * Export includes collection
   */
  private async exportIncludes(): Promise<void> {
    console.log('[6/8] Exporting includes...');

    const includes = this.db.prepare(`
      SELECT * FROM includes
    `).all() as any[];

    await this.writeBatch('includes', includes, (inc) => ({
      tweetId: inc.tweetId,
      mediaKey: inc.mediaKey || null,
      referencedTweetId: inc.referencedTweetId || null,
      userId: inc.userId || null,
    }));

    this.stats.includes = includes.length;
    console.log(`  ✓ ${includes.length} includes exported`);
  }

  /**
   * Export text annotations collection
   */
  private async exportAnnotations(): Promise<void> {
    console.log('[7/8] Exporting text annotations...');

    const annotations = this.db.prepare(`
      SELECT * FROM text_annotations
    `).all() as any[];

    await this.writeBatch('textAnnotations', annotations, (ann) => ({
      tweetId: ann.tweetId,
      type: ann.type,
      start: ann.start,
      end: ann.end,
      tag: ann.tag || null,
      url: ann.url || null,
      expandedUrl: ann.expandedUrl || null,
      displayUrl: ann.displayUrl || null,
      unwoundUrl: ann.unwoundUrl || null,
      userId: ann.userId || null,
      username: ann.username || null,
    }));

    this.stats.annotations = annotations.length;
    console.log(`  ✓ ${annotations.length} annotations exported`);
  }

  /**
   * Export media content (base64 images)
   */
  private async exportMediaContent(): Promise<void> {
    console.log('[8/8] Exporting media content (base64 images)...');
    console.log('  ⚠️  Warning: This will upload large base64 data to Firestore');
    console.log('  ⚠️  Consider using Cloud Storage instead for production use');

    const mediaContent = this.db.prepare(`
      SELECT * FROM media_content
    `).all() as any[];

    // Upload in smaller batches due to large size
    const smallBatchSize = 10;
    let processed = 0;

    while (processed < mediaContent.length) {
      const batch = mediaContent.slice(processed, processed + smallBatchSize);

      await this.writeBatch('mediaContent', batch, (mc) => ({
        mediaKey: mc.mediaKey,
        base64Data: mc.base64Data,
        mimeType: mc.mimeType,
        sizeBytes: mc.sizeBytes,
        capturedAt: mc.capturedAt,
        sourceUrl: mc.sourceUrl || null,
        captureMethod: mc.captureMethod,
      }));

      processed += batch.length;
      console.log(`  → Uploaded ${processed}/${mediaContent.length} images`);
    }

    this.stats.mediaContent = mediaContent.length;
    console.log(`  ✓ ${mediaContent.length} media content records exported`);
  }

  /**
   * Write batch to Firestore
   */
  private async writeBatch<T>(
    collectionName: string,
    records: T[],
    mapper: (record: T) => any,
    docIdGetter?: (record: T) => string
  ): Promise<void> {
    if (this.options.dryRun) {
      console.log(`  [DRY RUN] Would write ${records.length} records to ${collectionName}`);
      return;
    }

    if (!this.firestore) {
      throw new Error('Firestore not initialized');
    }

    const collection = this.firestore.collection(collectionName);
    let batch: WriteBatch | null = null;
    let batchCount = 0;

    for (let i = 0; i < records.length; i++) {
      const record = records[i];

      // Create new batch if needed
      if (batchCount === 0) {
        batch = this.firestore.batch();
      }

      // Get document ID
      const docId = docIdGetter ? docIdGetter(record) : (record as any).id?.toString();
      const docRef = docId ? collection.doc(docId) : collection.doc();

      // Map and set data
      const data = mapper(record);
      batch!.set(docRef, data);
      batchCount++;

      // Commit batch when full or at end
      if (batchCount === this.options.batchSize || i === records.length - 1) {
        try {
          await batch!.commit();
          this.stats.batches++;
          batchCount = 0;
          batch = null;
        } catch (error) {
          console.error(`  ✗ Batch write failed:`, error);
          this.stats.errors++;
          throw error;
        }
      }
    }
  }

  /**
   * Print export summary
   */
  private printSummary(duration: string): void {
    console.log('\n─────────────────────────────────────────');
    console.log('📊 Export Summary');
    console.log('─────────────────────────────────────────');
    console.log(`Users:            ${this.stats.users.toLocaleString()}`);
    console.log(`Tweets:           ${this.stats.tweets.toLocaleString()}`);
    console.log(`Metrics:          ${this.stats.metrics.toLocaleString()}`);
    console.log(`Media:            ${this.stats.media.toLocaleString()}`);
    console.log(`Media Keys:       ${this.stats.mediaKeys.toLocaleString()}`);
    console.log(`Includes:         ${this.stats.includes.toLocaleString()}`);
    console.log(`Annotations:      ${this.stats.annotations.toLocaleString()}`);

    if (this.options.includeMedia) {
      console.log(`Media Content:    ${this.stats.mediaContent.toLocaleString()}`);
    }

    console.log(`\nBatches Written:  ${this.stats.batches.toLocaleString()}`);
    console.log(`Errors:           ${this.stats.errors}`);
    console.log(`Duration:         ${duration}s`);
    console.log('─────────────────────────────────────────');

    if (this.options.dryRun) {
      console.log('\n✓ Dry run complete - no data written');
    } else {
      console.log('\n✅ Export complete!');
      console.log(`\nView in Firebase Console:`);
      console.log(`https://console.firebase.google.com/project/${this.options.projectId}/firestore`);
    }
  }
}

/**
 * Parse command line arguments
 */
function parseArgs(): ExportOptions {
  const args = process.argv.slice(2);

  const options: ExportOptions = {
    dbPath: 'out/bookmarks.db',
    projectId: 'crumbs-a4fdb',
    batchSize: 500,
    dryRun: false,
    includeMedia: false,
  };

  for (const arg of args) {
    if (arg.startsWith('--db=')) {
      options.dbPath = arg.split('=')[1];
    } else if (arg.startsWith('--project=')) {
      options.projectId = arg.split('=')[1];
    } else if (arg.startsWith('--service-account=')) {
      options.serviceAccountPath = arg.split('=')[1];
    } else if (arg.startsWith('--batch-size=')) {
      options.batchSize = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--include-media') {
      options.includeMedia = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

/**
 * Print help
 */
function printHelp(): void {
  console.log(`
Firebase Export - SQLite → Firestore Migration

Usage:
  npm run firebase:export [options]

Options:
  --db=<path>                SQLite database path (default: out/bookmarks.db)
  --project=<id>             Firebase project ID (default: crumbs-a4fdb)
  --service-account=<path>   Path to service account JSON file (optional)
  --batch-size=<n>           Firestore batch size (default: 500, max: 500)
  --dry-run                  Validate without writing to Firestore
  --include-media            Include base64 media content (WARNING: large!)
  -h, --help                 Show this help

Authentication:
  1. Service account file:
     --service-account=/path/to/serviceAccountKey.json

  2. Application default credentials (recommended):
     gcloud auth application-default login
     (automatically used if no service account provided)

Examples:
  # Dry run to validate
  npm run firebase:export -- --dry-run

  # Export to production (uses crumbs-a4fdb by default)
  npm run firebase:export

  # Export to different project
  npm run firebase:export -- --project=other-project-id

  # Export with service account
  npm run firebase:export -- --service-account=./crumbs-key.json

  # Export including base64 images (WARNING: expensive!)
  npm run firebase:export -- --include-media

Firestore Collections Created:
  /users/{userId}              User profiles
  /tweets/{tweetId}            Tweet data
  /metrics/{tweetId}           Engagement metrics
  /media/{mediaKey}            Media metadata
  /mediaKeys/{id}              Tweet-media mappings
  /includes/{id}               Relationships
  /textAnnotations/{id}        Text annotations
  /mediaContent/{mediaKey}     Base64 images (if --include-media)

Note:
  - Base64 images (~400MB) will be expensive in Firestore
  - Consider using Cloud Storage for images instead
  - Use --dry-run first to validate
`);
}

/**
 * Main function
 */
async function main() {
  const options = parseArgs();

  // Validate database exists
  if (!existsSync(options.dbPath)) {
    console.error(`❌ Database not found: ${options.dbPath}`);
    console.error('\nRun extraction first:');
    console.error('  npm run extract:sqlite');
    process.exit(1);
  }

  // Create exporter and run
  const exporter = new FirebaseExporter(options);

  try {
    await exporter.export();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Export failed:', error);
    process.exit(1);
  }
}

export { FirebaseExporter, type ExportOptions };

// Run if executed directly (always run when this file is the entry point)
main().catch((error) => {
  console.error('[FATAL]', error);
  process.exit(1);
});
