#!/usr/bin/env node
/**
 * CLI Entry Point for X Bookmarks Scraper
 */

import { BookmarksCapture, type CaptureMode } from './bookmarks-capture.js';
import { existsSync, mkdirSync } from 'fs';

interface CliOptions {
  mode: CaptureMode;
  headless: boolean;
  maxScrolls: number;
  scrollDelay: number;
  noGrowthThreshold: number;
  profileDir: string;
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
X Bookmarks Scraper

Usage:
  npm run discover         Run in discovery mode to analyze GraphQL response structure
  npm run extract          Run in extraction mode to export bookmarks to JSONL files

Options:
  --mode=<discover|extract>    Set the capture mode (default: extract)
  --headless                   Run browser in headless mode (default: false)
  --max-scrolls=<number>       Maximum number of scrolls (default: 1000)
  --scroll-delay=<ms>          Delay between scrolls in milliseconds (default: 1000)
  --no-growth-threshold=<n>    Stop after N scrolls with no new bookmarks (default: 6)
  --profile-dir=<path>         Chrome profile directory (default: ./x-profile)
  -h, --help                   Show this help message

Examples:
  npm run discover                    # Discover GraphQL response structure
  npm run extract                     # Extract all bookmarks to JSONL
  npm run extract -- --headless       # Run extraction in headless mode
  npm run extract -- --max-scrolls=50 # Limit to 50 scrolls for testing

Output:
  Discovery mode:
    out/discovery.jsonl          # GraphQL response analysis
    out/x-bookmarks.har.zip      # HAR recording of GraphQL requests

  Extraction mode:
    out/tweetEntity.jsonl        # Tweet data
    out/twitterUser.jsonl        # User data
    out/tweetPublicMetrics.jsonl # Tweet metrics
    out/tweetMedia.jsonl         # Media entities
    out/tweetIncludes.jsonl      # Relationship joins
    out/tweetTextEntityAnnotation.jsonl  # Text annotations
    out/mediaKeys.jsonl          # Media key mappings
    out/referencedTweets_byTweet.jsonl   # Referenced tweets
    out/x-bookmarks.har.zip      # HAR recording
    out/report.json              # Extraction summary
`);
}

/**
 * Main function
 */
async function main() {
  console.log('X Bookmarks Scraper v1.0.0\n');

  const options = parseArgs();

  // Ensure output directory exists
  if (!existsSync('out')) {
    mkdirSync('out', { recursive: true });
  }

  // Create and run capture
  const capture = new BookmarksCapture(options);

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
