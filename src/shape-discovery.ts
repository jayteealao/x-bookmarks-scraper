/**
 * Shape Discovery Module
 * Analyzes GraphQL responses to identify bookmark timeline structure
 */

import { writeFileSync, appendFileSync } from 'fs';
import type { DiscoveryEntry } from './types.js';

export class ShapeDiscovery {
  private discoveries: DiscoveryEntry[] = [];
  private responseCount = 0;
  private maxSamples = 20;

  /**
   * Analyze a GraphQL response and record its shape
   */
  analyzeResponse(url: string, json: any): void {
    this.responseCount++;

    const discovery: DiscoveryEntry = {
      url,
      timestamp: new Date().toISOString(),
      topLevelKeys: [],
      dataKeys: [],
      hasTimeline: false,
    };

    try {
      // Extract operation name from URL if present
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/');
      const opIndex = pathParts.findIndex(p => p === 'graphql');
      if (opIndex >= 0 && pathParts[opIndex + 1]) {
        discovery.operationName = pathParts[opIndex + 1];
      }

      // Get top-level keys
      if (typeof json === 'object' && json !== null) {
        discovery.topLevelKeys = Object.keys(json);
      }

      // Get data keys
      if (json.data && typeof json.data === 'object') {
        discovery.dataKeys = Object.keys(json.data);
      }

      // Detect timeline-ish structures
      const timelineInfo = this.detectTimeline(json);
      discovery.hasTimeline = timelineInfo.found;
      discovery.timelinePath = timelineInfo.path;
      discovery.sampleEntryTypes = timelineInfo.sampleTypes;

      if (discovery.hasTimeline) {
        console.log(`\n[Discovery] Found timeline in ${discovery.operationName || 'unknown operation'}`);
        console.log(`  Path: ${discovery.timelinePath}`);
        console.log(`  Entry types: ${discovery.sampleEntryTypes?.join(', ')}`);

        // Print a small sample
        if (timelineInfo.sample) {
          console.log(`  Sample structure:`);
          console.log(JSON.stringify(timelineInfo.sample, null, 2).substring(0, 500));
        }
      }

    } catch (error) {
      discovery.error = error instanceof Error ? error.message : String(error);
    }

    this.discoveries.push(discovery);
  }

  /**
   * Detect timeline-like structures in the response
   */
  private detectTimeline(obj: any, path: string = 'root'): {
    found: boolean;
    path?: string;
    sampleTypes?: string[];
    sample?: any;
  } {
    if (!obj || typeof obj !== 'object') {
      return { found: false };
    }

    // Check for common timeline patterns
    const timelineKeys = ['timeline', 'instructions', 'entries', 'bookmark_timeline'];

    for (const key of Object.keys(obj)) {
      const value = obj[key];
      const currentPath = path === 'root' ? key : `${path}.${key}`;

      // Check if this looks like a timeline structure
      if (timelineKeys.some(tk => key.toLowerCase().includes(tk))) {
        // Look for instructions array
        if (value && typeof value === 'object') {
          if (value.timeline?.instructions) {
            const instructions = value.timeline.instructions;
            const sampleTypes = this.extractInstructionTypes(instructions);
            return {
              found: true,
              path: `${currentPath}.timeline.instructions`,
              sampleTypes,
              sample: instructions[0],
            };
          } else if (value.instructions) {
            const sampleTypes = this.extractInstructionTypes(value.instructions);
            return {
              found: true,
              path: `${currentPath}.instructions`,
              sampleTypes,
              sample: value.instructions[0],
            };
          } else if (Array.isArray(value)) {
            // Direct entries array
            const sampleTypes = value.slice(0, 3).map((e: any) =>
              e.entryId || e.content?.entryType || 'unknown'
            );
            return {
              found: true,
              path: currentPath,
              sampleTypes,
              sample: value[0],
            };
          }
        }
      }

      // Recurse
      if (typeof value === 'object' && value !== null) {
        const result = this.detectTimeline(value, currentPath);
        if (result.found) {
          return result;
        }
      }
    }

    return { found: false };
  }

  /**
   * Extract instruction/entry types from an array
   */
  private extractInstructionTypes(arr: any[]): string[] {
    if (!Array.isArray(arr)) return [];

    return arr.slice(0, 5).map(item => {
      if (item.type) return item.type;
      if (item.entryId) return item.entryId.split('-')[0];
      if (item.content?.entryType) return item.content.entryType;
      return 'unknown';
    });
  }

  /**
   * Check if we should continue discovering
   */
  shouldContinue(): boolean {
    const hasFoundTimeline = this.discoveries.some(d => d.hasTimeline);

    // Stop if we found a timeline and have enough samples
    if (hasFoundTimeline && this.responseCount >= 5) {
      return false;
    }

    // Or stop at max samples
    return this.responseCount < this.maxSamples;
  }

  /**
   * Save discoveries to JSONL file
   */
  saveDiscoveries(): void {
    const outputPath = 'out/discovery.jsonl';

    // Clear file
    writeFileSync(outputPath, '');

    // Write each discovery as a line
    for (const discovery of this.discoveries) {
      appendFileSync(outputPath, JSON.stringify(discovery) + '\n');
    }

    console.log(`\n[Discovery] Saved ${this.discoveries.length} discoveries to ${outputPath}`);

    // Print summary
    const timelineDiscoveries = this.discoveries.filter(d => d.hasTimeline);
    console.log(`\nSummary:`);
    console.log(`  Total GraphQL responses: ${this.discoveries.length}`);
    console.log(`  Timeline responses: ${timelineDiscoveries.length}`);

    if (timelineDiscoveries.length > 0) {
      console.log(`\nTimeline paths found:`);
      const uniquePaths = new Set(timelineDiscoveries.map(d => d.timelinePath).filter(Boolean));
      uniquePaths.forEach(path => console.log(`  - ${path}`));
    }
  }

  /**
   * Get the most likely timeline path from discoveries
   */
  getMostLikelyTimelinePath(): string | null {
    const timelineDiscoveries = this.discoveries.filter(d => d.hasTimeline);
    if (timelineDiscoveries.length === 0) return null;

    // Return the most common path
    const pathCounts = new Map<string, number>();
    for (const d of timelineDiscoveries) {
      if (d.timelinePath) {
        pathCounts.set(d.timelinePath, (pathCounts.get(d.timelinePath) || 0) + 1);
      }
    }

    let maxCount = 0;
    let mostCommonPath: string | null = null;
    for (const [path, count] of pathCounts) {
      if (count > maxCount) {
        maxCount = count;
        mostCommonPath = path;
      }
    }

    return mostCommonPath;
  }
}
