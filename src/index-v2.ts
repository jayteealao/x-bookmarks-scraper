#!/usr/bin/env node
/**
 * CLI Entry Point for X Bookmarks Scraper V2
 * Enhanced with checkpoint resume, SQLite, media download, adaptive scrolling
 */

import { BookmarksCaptureV2, type CaptureMode } from './bookmarks-capture-v2.js';
import { existsSync, mkdirSync } from 'fs';

interface CliOptions {
  mode: CaptureMode;
  headless: boolean;
  maxScrolls: number;
  scrollDelay: number;
  noGrowthThreshold: number;
  profileDir: string;
  useSQLite: boolean;
  downloadMedia: boolean;
  noResume: boolean;
}

/**
 * Parse command line arguments
 */
function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    mode: 'extract',
    headless: false,
    maxScrolls: 1000,
    scrollDelay: 1000,
    noGrowthThreshold: 6,
    profileDir: './x-profile',
    useSQLite: false,
    downloadMedia: false,
    noResume: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith('--mode=')) {
      const mode = arg.split('=')[1];
      if (mode !== 'discover' && mode !== 'extract') {
        console.error(`Invalid mode: ${mode}. Must be 'discover' or 'extract'`);
        process.exit(1);
      }
      options.mode = mode as CaptureMode;
    } else if (arg === '--headless') {
      options.headless = true;
    } else if (arg.startsWith('--max-scrolls=')) {
      options.maxScrolls = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--scroll-delay=')) {
      options.scrollDelay = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--no-growth-threshold=')) {
      options.noGrowthThreshold = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--profile-dir=')) {
      options.profileDir = arg.split('=')[1];
    } else if (arg === '--sqlite') {
      options.useSQLite = true;
    } else if (arg === '--download-media') {
      options.downloadMedia = true;
    } else if (arg === '--no-resume') {
      options.noResume = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      printHelp();
      process.exit(1);
    }
  }

  return options;
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
X Bookmarks Scraper V2 - Enhanced Edition

Usage:
  npm run discover         Run in discovery mode to analyze GraphQL responses
  npm run extract          Run in extraction mode to export all bookmarks

Options:
  --mode=<discover|extract>    Set the capture mode (default: extract)
  --headless                   Run browser in headless mode (default: false)
  --max-scrolls=<number>       Maximum number of scrolls (default: 1000)
  --scroll-delay=<ms>          Base scroll delay - will adapt automatically (default: 1000)
  --no-growth-threshold=<n>    Stop after N scrolls with no growth (default: 6)
  --profile-dir=<path>         Chrome profile directory (default: ./x-profile)

  --sqlite                     Export to SQLite database instead of JSONL (default: false)
  --download-media             Download media files to out/media/ (default: false)
  --no-resume                  Start fresh, ignore checkpoint (default: false)

  -h, --help                   Show this help message

Features:
  ✓ Adaptive scroll speed     Automatically adjusts based on content loading
  ✓ Checkpoint & resume       Recover from crashes and continue where you left off
  ✓ Rate limit detection      Detects and warns about rate limiting
  ✓ Buffered async I/O        Fast, non-blocking writes with automatic flushing
  ✓ Progress metrics          Real-time stats on tweets/sec, memory usage, ETA
  ✓ SQLite export             Direct database export option
  ✓ Media download            Save images/videos locally
  ✓ Retry logic               Handles transient network failures

Examples:
  npm run discover                          # Analyze GraphQL structure
  npm run extract                           # Standard extraction to JSONL
  npm run extract -- --sqlite               # Export to SQLite database
  npm run extract -- --download-media       # Download all media files
  npm run extract -- --headless             # Run in headless mode
  npm run extract -- --max-scrolls=50       # Limit scrolls for testing
  npm run extract -- --no-resume            # Start fresh, ignore checkpoint

Output Files:
  Discovery mode:
    out/discovery.jsonl          GraphQL response analysis

  Extraction mode (JSONL):
    out/tweetEntity.jsonl        Tweet data
    out/twitterUser.jsonl        User profiles
    out/tweetPublicMetrics.jsonl Engagement metrics
    out/tweetMedia.jsonl         Media entities
    out/tweetIncludes.jsonl      Relationships
    out/tweetTextEntityAnnotation.jsonl Text annotations
    out/mediaKeys.jsonl          Media mappings
    out/referencedTweets_byTweet.jsonl Referenced tweets
    out/report.json              Summary report
    out/.checkpoint.json         Recovery checkpoint (auto-cleaned on success)

  Extraction mode (SQLite):
    out/bookmarks.db             All data in SQLite database

  Media download:
    out/media/*.jpg              Downloaded images/videos

  Both modes:
    out/x-bookmarks.har.zip      Network traffic recording
`);
}

/**
 * Main function
 */
async function main() {
  console.log('X Bookmarks Scraper V2 - Enhanced Edition\n');

  const options = parseArgs();

  // Ensure output directory exists
  if (!existsSync('out')) {
    mkdirSync('out', { recursive: true });
  }

  // Create and run capture
  const capture = new BookmarksCaptureV2({
    mode: options.mode,
    headless: options.headless,
    maxScrolls: options.maxScrolls,
    scrollDelay: options.scrollDelay,
    noGrowthThreshold: options.noGrowthThreshold,
    profileDir: options.profileDir,
    useSQLite: options.useSQLite,
    downloadMedia: options.downloadMedia,
    resumeFromCheckpoint: !options.noResume,
  });

  try {
    await capture.run();
    console.log('\n✅ Success!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main };
