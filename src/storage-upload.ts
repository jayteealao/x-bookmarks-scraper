#!/usr/bin/env node
/**
 * Cloud Storage Upload Script
 * Uploads base64 images from SQLite to Firebase Cloud Storage
 *
 * Usage:
 *   npm run storage:upload
 *   npm run storage:upload -- --dry-run
 *   npm run storage:upload -- --update-firestore
 */

import { initializeApp, cert, type ServiceAccount } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { getFirestore } from 'firebase-admin/firestore';
import Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'fs';

interface UploadOptions {
  dbPath: string;
  projectId: string;
  storageBucket: string;
  serviceAccountPath?: string;
  dryRun: boolean;
  updateFirestore: boolean;
  concurrency: number;
  pathPrefix: string;
}

interface UploadStats {
  total: number;
  uploaded: number;
  skipped: number;
  failed: number;
  totalBytes: number;
  errors: string[];
}

interface MediaContentRow {
  mediaKey: string;
  base64Data: string;
  mimeType: string;
  sizeBytes: number;
  sourceUrl: string;
}

class StorageUploader {
  private db: Database.Database;
  private storage?: ReturnType<typeof getStorage>;
  private firestore?: ReturnType<typeof getFirestore>;
  private options: UploadOptions;
  private stats: UploadStats = {
    total: 0,
    uploaded: 0,
    skipped: 0,
    failed: 0,
    totalBytes: 0,
    errors: [],
  };

  constructor(options: UploadOptions) {
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
    console.log(`[Storage] Initializing Firebase Admin SDK...`);
    console.log(`[Storage] Project ID: ${this.options.projectId}`);
    console.log(`[Storage] Bucket: ${this.options.storageBucket}`);

    try {
      let app;

      if (this.options.serviceAccountPath && existsSync(this.options.serviceAccountPath)) {
        const serviceAccount = JSON.parse(
          readFileSync(this.options.serviceAccountPath, 'utf-8')
        ) as ServiceAccount;

        app = initializeApp({
          credential: cert(serviceAccount),
          projectId: this.options.projectId,
          storageBucket: this.options.storageBucket,
        });
      } else {
        app = initializeApp({
          projectId: this.options.projectId,
          storageBucket: this.options.storageBucket,
        });
      }

      this.storage = getStorage(app);

      if (this.options.updateFirestore) {
        this.firestore = getFirestore(app);
      }

      console.log(`[Storage] ✓ Connected to Cloud Storage`);
      if (this.options.updateFirestore) {
        console.log(`[Storage] ✓ Connected to Firestore (will update URLs)`);
      }
    } catch (error) {
      console.error(`[Storage] Failed to initialize:`, error);
      throw error;
    }
  }

  /**
   * Upload all images to Cloud Storage
   */
  async upload(): Promise<void> {
    console.log('\n╔═══════════════════════════════════════════╗');
    console.log('║  Cloud Storage Upload - SQLite → Storage  ║');
    console.log('╚═══════════════════════════════════════════╝');
    console.log(`Source: ${this.options.dbPath}`);
    console.log(`Destination: gs://${this.options.storageBucket}/${this.options.pathPrefix}`);
    console.log(`Dry Run: ${this.options.dryRun ? 'YES (no uploads)' : 'NO'}`);
    console.log(`Update Firestore: ${this.options.updateFirestore ? 'YES' : 'NO'}\n`);

    const startTime = Date.now();

    try {
      // Get all media content from SQLite
      const mediaContent = this.getAllMediaContent();
      this.stats.total = mediaContent.length;

      console.log(`[Storage] Found ${this.stats.total} images in database`);
      console.log(`[Storage] Starting upload with concurrency: ${this.options.concurrency}\n`);

      // Upload in batches with concurrency control
      await this.uploadBatch(mediaContent);

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      this.printSummary(duration);
    } catch (error) {
      console.error('\n❌ Upload failed:', error);
      throw error;
    } finally {
      this.db.close();
    }
  }

  /**
   * Get all media content from SQLite
   */
  private getAllMediaContent(): MediaContentRow[] {
    const query = `
      SELECT
        mediaKey,
        base64Data,
        mimeType,
        sizeBytes,
        sourceUrl
      FROM media_content
      ORDER BY sizeBytes ASC
    `;

    return this.db.prepare(query).all() as MediaContentRow[];
  }

  /**
   * Upload batch of images with concurrency control
   */
  private async uploadBatch(mediaContent: MediaContentRow[]): Promise<void> {
    const chunks: MediaContentRow[][] = [];

    // Split into chunks based on concurrency
    for (let i = 0; i < mediaContent.length; i += this.options.concurrency) {
      chunks.push(mediaContent.slice(i, i + this.options.concurrency));
    }

    // Process each chunk
    for (const chunk of chunks) {
      const uploadPromises = chunk.map(media => this.uploadImage(media));
      await Promise.all(uploadPromises);

      // Progress update
      const processed = Math.min(this.stats.uploaded + this.stats.skipped + this.stats.failed, this.stats.total);
      const percent = ((processed / this.stats.total) * 100).toFixed(1);
      console.log(`[Progress] ${processed}/${this.stats.total} (${percent}%) - ${this.stats.uploaded} uploaded, ${this.stats.failed} failed, ${this.stats.skipped} skipped`);
    }
  }

  /**
   * Upload a single image to Cloud Storage
   */
  private async uploadImage(media: MediaContentRow): Promise<void> {
    const { mediaKey, base64Data, mimeType, sizeBytes } = media;

    try {
      // Determine file extension from mimeType
      const ext = this.getExtensionFromMimeType(mimeType);
      const fileName = `${mediaKey}${ext}`;
      const filePath = `${this.options.pathPrefix}/${fileName}`;

      if (this.options.dryRun) {
        console.log(`[DRY RUN] Would upload ${fileName} (${this.formatBytes(sizeBytes)})`);
        this.stats.uploaded++;
        this.stats.totalBytes += sizeBytes;
        return;
      }

      // Check if file already exists
      const bucket = this.storage!.bucket();
      const file = bucket.file(filePath);
      const [exists] = await file.exists();

      if (exists) {
        this.stats.skipped++;
        return;
      }

      // Convert base64 to buffer
      const buffer = Buffer.from(base64Data, 'base64');

      // Upload to Cloud Storage
      await file.save(buffer, {
        metadata: {
          contentType: mimeType,
          metadata: {
            mediaKey: mediaKey,
            originalSize: sizeBytes.toString(),
            source: 'x-bookmarks-scraper',
          },
        },
        public: false, // Private by default
        resumable: false, // Faster for small files
      });

      this.stats.uploaded++;
      this.stats.totalBytes += sizeBytes;

      // Update Firestore if requested
      if (this.options.updateFirestore && this.firestore) {
        await this.updateFirestoreUrl(mediaKey, filePath);
      }

    } catch (error) {
      this.stats.failed++;
      const errorMsg = `${mediaKey}: ${error instanceof Error ? error.message : error}`;
      this.stats.errors.push(errorMsg);

      if (this.stats.errors.length <= 10) {
        console.error(`[Error] ${errorMsg}`);
      }
    }
  }

  /**
   * Update Firestore media document with storage URL
   */
  private async updateFirestoreUrl(mediaKey: string, storagePath: string): Promise<void> {
    if (!this.firestore) return;

    try {
      const mediaRef = this.firestore.collection('media').doc(mediaKey);

      // Generate public URL (will need to configure Firebase Storage rules)
      const storageUrl = `https://firebasestorage.googleapis.com/v0/b/${this.options.storageBucket}/o/${encodeURIComponent(storagePath)}?alt=media`;

      await mediaRef.update({
        storageUrl: storageUrl,
        storagePath: storagePath,
        storageUpdatedAt: new Date().toISOString(),
      });
    } catch (error) {
      // Silently fail - document might not exist in Firestore yet
      // This is okay if user exported metadata without images
    }
  }

  /**
   * Get file extension from MIME type
   */
  private getExtensionFromMimeType(mimeType: string): string {
    const mimeMap: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
    };

    return mimeMap[mimeType.toLowerCase()] || '.jpg';
  }

  /**
   * Format bytes to human readable
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  }

  /**
   * Print upload summary
   */
  private printSummary(duration: string): void {
    console.log('\n─────────────────────────────────────────');
    console.log('📦 Cloud Storage Upload Summary');
    console.log('─────────────────────────────────────────');
    console.log(`Total images:     ${this.stats.total.toLocaleString()}`);
    console.log(`Uploaded:         ${this.stats.uploaded.toLocaleString()}`);
    console.log(`Skipped:          ${this.stats.skipped.toLocaleString()} (already exist)`);
    console.log(`Failed:           ${this.stats.failed.toLocaleString()}`);
    console.log(`Total size:       ${this.formatBytes(this.stats.totalBytes)}`);
    console.log(`Duration:         ${duration}s`);
    console.log('─────────────────────────────────────────');

    if (this.stats.failed > 0) {
      console.log(`\n⚠️  ${this.stats.failed} uploads failed`);
      if (this.stats.errors.length > 0) {
        console.log('\nFirst 10 errors:');
        this.stats.errors.slice(0, 10).forEach(err => console.log(`  - ${err}`));
      }
    }

    if (this.options.dryRun) {
      console.log('\n✓ Dry run complete - no uploads performed');
    } else {
      console.log('\n✅ Upload complete!');
      console.log(`\nView files in Cloud Storage:`);
      console.log(`https://console.firebase.google.com/project/${this.options.projectId}/storage/${this.options.storageBucket}/files`);

      if (this.options.updateFirestore) {
        console.log(`\nFirestore media documents updated with storage URLs`);
      }
    }
  }
}

/**
 * Parse command line arguments
 */
function parseArgs(): UploadOptions {
  const args = process.argv.slice(2);

  const options: UploadOptions = {
    dbPath: 'out/bookmarks.db',
    projectId: 'crumbs-a4fdb',
    storageBucket: 'crumbs-a4fdb.firebasestorage.app',
    dryRun: false,
    updateFirestore: false,
    concurrency: 10,
    pathPrefix: 'bookmarks/media',
  };

  for (const arg of args) {
    if (arg.startsWith('--db=')) {
      options.dbPath = arg.split('=')[1];
    } else if (arg.startsWith('--project=')) {
      options.projectId = arg.split('=')[1];
    } else if (arg.startsWith('--bucket=')) {
      options.storageBucket = arg.split('=')[1];
    } else if (arg.startsWith('--service-account=')) {
      options.serviceAccountPath = arg.split('=')[1];
    } else if (arg.startsWith('--concurrency=')) {
      options.concurrency = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--path-prefix=')) {
      options.pathPrefix = arg.split('=')[1];
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--update-firestore') {
      options.updateFirestore = true;
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
Cloud Storage Upload - SQLite → Firebase Storage

Usage:
  npm run storage:upload [options]

Options:
  --db=<path>                SQLite database path (default: out/bookmarks.db)
  --project=<id>             Firebase project ID (default: crumbs-a4fdb)
  --bucket=<bucket>          Storage bucket (default: crumbs-a4fdb.firebasestorage.app)
  --service-account=<path>   Path to service account JSON file (optional)
  --concurrency=<n>          Concurrent uploads (default: 10)
  --path-prefix=<prefix>     Storage path prefix (default: bookmarks/media)
  --dry-run                  Validate without uploading
  --update-firestore         Update Firestore media docs with storage URLs
  -h, --help                 Show this help

Authentication:
  Same as firebase:export - uses application default credentials or service account

Examples:
  # Dry run to validate
  npm run storage:upload -- --dry-run

  # Upload images to Cloud Storage
  npm run storage:upload

  # Upload and update Firestore with storage URLs
  npm run storage:upload -- --update-firestore

  # Custom bucket and path
  npm run storage:upload -- --bucket=my-bucket.appspot.com --path-prefix=images

  # Higher concurrency for faster upload
  npm run storage:upload -- --concurrency=20

Storage Structure:
  gs://crumbs-a4fdb.firebasestorage.app/
    └── bookmarks/
        └── media/
            ├── {mediaKey1}.jpg
            ├── {mediaKey2}.png
            └── {mediaKey3}.webp

Storage URLs:
  Each uploaded image will be accessible at:
  https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{path}?alt=media

Firestore Updates (if --update-firestore):
  /media/{mediaKey}
    - storageUrl: "https://firebasestorage.googleapis.com/..."
    - storagePath: "bookmarks/media/{mediaKey}.jpg"
    - storageUpdatedAt: "2024-01-01T00:00:00Z"

Cost Estimate:
  Storage: $0.026/GB/month (~$0.01/month for 400MB)
  Network egress: First 1GB/day free
  Operations: Very cheap ($0.05 per 10k operations)

  Much cheaper than Firestore for large files!

Next Steps:
  1. Run with --dry-run to validate
  2. Upload images to Cloud Storage
  3. Update Firestore media documents (optional)
  4. Configure Storage security rules
  5. Query images in your app using storage URLs
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
    console.error('\nRun media capture first:');
    console.error('  npm run media-capture-only');
    process.exit(1);
  }

  // Create uploader and run
  const uploader = new StorageUploader(options);

  try {
    await uploader.upload();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Upload failed:', error);
    process.exit(1);
  }
}

export { StorageUploader, type UploadOptions };

// Run if executed directly
main().catch((error) => {
  console.error('[FATAL]', error);
  process.exit(1);
});
