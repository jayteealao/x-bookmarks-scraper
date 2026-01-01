#!/usr/bin/env node
/**
 * HAR Verification Script
 * Compares HAR recording against live capture results
 */

import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';

interface HAREntry {
  request: {
    url: string;
    method: string;
  };
  response: {
    status: number;
    content: {
      size: number;
      mimeType: string;
    };
  };
}

interface HAR {
  log: {
    version: string;
    creator: any;
    pages: any[];
    entries: HAREntry[];
  };
}

/**
 * Extract and read HAR file
 */
function readHAR(harPath: string): HAR | null {
  if (!existsSync(harPath)) {
    console.error(`HAR file not found: ${harPath}`);
    return null;
  }

  try {
    // Create temp directory for extraction
    const tempDir = join(tmpdir(), 'x-bookmarks-har-' + Date.now());
    const harJsonPath = join(tempDir, 'x-bookmarks.har');

    // Unzip HAR file
    console.log('Extracting HAR file...');
    execSync(`mkdir -p "${tempDir}"`);
    execSync(`unzip -q "${harPath}" -d "${tempDir}"`);

    // Read HAR JSON
    const harContent = readFileSync(harJsonPath, 'utf-8');
    const har: HAR = JSON.parse(harContent);

    // Cleanup
    execSync(`rm -rf "${tempDir}"`);

    return har;
  } catch (error) {
    console.error('Error reading HAR file:', error);
    return null;
  }
}

/**
 * Read extraction report
 */
function readReport(reportPath: string): any | null {
  if (!existsSync(reportPath)) {
    console.error(`Report file not found: ${reportPath}`);
    return null;
  }

  try {
    const content = readFileSync(reportPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Error reading report:', error);
    return null;
  }
}

/**
 * Analyze HAR entries
 */
function analyzeHAR(har: HAR): {
  totalRequests: number;
  graphqlRequests: number;
  graphqlUrls: Map<string, number>;
  responseSizes: number[];
} {
  const stats = {
    totalRequests: har.log.entries.length,
    graphqlRequests: 0,
    graphqlUrls: new Map<string, number>(),
    responseSizes: [] as number[],
  };

  for (const entry of har.log.entries) {
    const url = entry.request.url;

    if (url.includes('/i/api/graphql/')) {
      stats.graphqlRequests++;
      stats.responseSizes.push(entry.response.content.size);

      // Extract operation name from URL
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/');
      const opIndex = pathParts.findIndex(p => p === 'graphql');
      const operation = opIndex >= 0 && pathParts[opIndex + 1]
        ? pathParts[opIndex + 1]
        : 'unknown';

      stats.graphqlUrls.set(
        operation,
        (stats.graphqlUrls.get(operation) || 0) + 1
      );
    }
  }

  return stats;
}

/**
 * Main verification function
 */
async function main() {
  console.log('X Bookmarks HAR Verification\n');

  const harPath = 'out/x-bookmarks.har.zip';
  const reportPath = 'out/report.json';

  // Read HAR
  console.log('Reading HAR file...');
  const har = readHAR(harPath);
  if (!har) {
    console.error('Failed to read HAR file');
    process.exit(1);
  }

  // Read report
  console.log('Reading extraction report...');
  const report = readReport(reportPath);

  // Analyze HAR
  const harStats = analyzeHAR(har);

  // Print comparison
  console.log('\n=== HAR vs Live Capture Comparison ===\n');

  console.log('HAR Recording:');
  console.log(`  Total HTTP requests: ${harStats.totalRequests}`);
  console.log(`  GraphQL requests: ${harStats.graphqlRequests}`);

  console.log('\nGraphQL operations in HAR:');
  const sortedOps = Array.from(harStats.graphqlUrls.entries())
    .sort((a, b) => b[1] - a[1]);
  for (const [operation, count] of sortedOps) {
    console.log(`  ${operation}: ${count}`);
  }

  if (harStats.responseSizes.length > 0) {
    const avgSize = harStats.responseSizes.reduce((a, b) => a + b, 0) / harStats.responseSizes.length;
    const totalSize = harStats.responseSizes.reduce((a, b) => a + b, 0);
    console.log(`\nResponse sizes:`);
    console.log(`  Average: ${(avgSize / 1024).toFixed(2)} KB`);
    console.log(`  Total: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
  }

  if (report) {
    console.log('\nLive Capture (from report.json):');
    console.log(`  GraphQL responses processed: ${report.totalGraphQLResponses}`);
    console.log(`  Unique tweets extracted: ${report.uniqueTweets}`);
    console.log(`  Unique users: ${report.uniqueUsers}`);
    console.log(`  Parse errors: ${report.parseErrors}`);

    console.log('\n=== Comparison ===');
    const diff = harStats.graphqlRequests - report.totalGraphQLResponses;
    console.log(`HAR recorded ${harStats.graphqlRequests} GraphQL requests`);
    console.log(`Live capture processed ${report.totalGraphQLResponses} responses`);
    console.log(`Difference: ${diff}`);

    if (diff > 0) {
      console.log('\n⚠️  HAR captured more requests than live processing.');
      console.log('This is expected if:');
      console.log('  - Some responses were not JSON');
      console.log('  - Some requests failed or timed out');
      console.log('  - Response interceptor missed some responses due to timing');
    } else if (diff < 0) {
      console.log('\n⚠️  Live processing handled more responses than HAR recorded.');
      console.log('This may indicate an issue with HAR recording.');
    } else {
      console.log('\n✅ HAR and live capture counts match perfectly!');
    }
  } else {
    console.log('\n⚠️  No report.json found. Run extraction mode first.');
  }

  console.log('\n=== Notes ===');
  console.log('HAR files capture all network traffic but may not include response bodies');
  console.log('for all requests depending on the recording mode.');
  console.log('Live capture processes responses in real-time as they arrive.');
  console.log('Small differences are normal and expected.');
}

// Run
main().catch(console.error);
