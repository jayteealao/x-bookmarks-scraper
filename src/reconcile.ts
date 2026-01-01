#!/usr/bin/env node
/**
 * Standalone HAR Reconciliation Script
 * Re-processes HAR file to recover any missed data
 *
 * Usage: npm run reconcile
 */

import { HarReconciler } from './har-reconciler.js';
import { BookmarkMapperV2 } from './mapper-v2.js';
import { existsSync, readFileSync } from 'fs';

async function main() {
  console.log('HAR Reconciliation Tool\n');
  console.log('═'.repeat(50));

  const harPath = 'out/x-bookmarks.har.zip';

  if (!existsSync(harPath)) {
    console.error(`\n❌ HAR file not found: ${harPath}`);
    console.error('Run an extraction first to create a HAR file.');
    process.exit(1);
  }

  // Check for existing extraction
  const tweetsFile = 'out/tweetEntity.jsonl';
  let existingTweetIds = new Set<string>();

  if (existsSync(tweetsFile)) {
    console.log('Found existing extraction, loading tweet IDs...');
    const lines = readFileSync(tweetsFile, 'utf-8').trim().split('\n');
    for (const line of lines) {
      try {
        const tweet = JSON.parse(line);
        if (tweet.tweetId) {
          existingTweetIds.add(tweet.tweetId);
        }
      } catch {
        // Skip malformed lines
      }
    }
    console.log(`Loaded ${existingTweetIds.size} existing tweets\n`);
  } else {
    console.log('No existing extraction found, will extract all from HAR\n');
  }

  // Parse command line for SQLite option
  const useSQLite = process.argv.includes('--sqlite');

  // Initialize mapper for recovery
  const mapper = new BookmarkMapperV2({
    useSQLite,
    downloadMedia: false,
    resumeFromCheckpoint: false, // Don't resume - we want fresh recovery
  });
  await mapper.initialize();

  // Pre-populate seen tweets from existing extraction
  for (const tweetId of existingTweetIds) {
    // Access private set via the getter
    mapper.getSeenTweetIds(); // This returns a copy, we need another approach
  }

  // Run reconciliation
  const reconciler = new HarReconciler(harPath);

  try {
    const result = await reconciler.reconcile(
      existingTweetIds,
      0, // Unknown response count
      async (harTweet) => {
        await mapper.recoverTweet(harTweet);
      }
    );

    // Generate report
    await mapper.generateReport();
    await mapper.close();

    console.log('\n✅ Reconciliation complete!');

    if (result.recovered.tweets > 0) {
      console.log(`\nRecovered ${result.recovered.tweets} tweets from HAR file.`);
      if (useSQLite) {
        console.log('Data added to out/bookmarks.db');
      } else {
        console.log('Data appended to JSONL files in out/');
      }
    }
  } catch (error) {
    console.error('\n❌ Reconciliation failed:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('[FATAL]', error);
  process.exit(1);
});
