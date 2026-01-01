/**
 * Bookmarks Capture Module
 * Playwright runner for capturing X Bookmarks via GraphQL responses
 */

import { chromium, type BrowserContext, type Response } from 'playwright';
import { ShapeDiscovery } from './shape-discovery.js';
import { BookmarkMapper } from './mapper.js';

export type CaptureMode = 'discover' | 'extract';

export interface CaptureOptions {
  mode: CaptureMode;
  headless?: boolean;
  maxScrolls?: number;
  scrollDelay?: number;
  noGrowthThreshold?: number;
  profileDir?: string;
}

export class BookmarksCapture {
  private options: Required<CaptureOptions>;
  private context?: BrowserContext;
  private discovery?: ShapeDiscovery;
  private mapper?: BookmarkMapper;

  constructor(options: CaptureOptions) {
    this.options = {
      headless: options.headless ?? false,
      maxScrolls: options.maxScrolls ?? 1000,
      scrollDelay: options.scrollDelay ?? 1000,
      noGrowthThreshold: options.noGrowthThreshold ?? 6,
      profileDir: options.profileDir ?? './x-profile',
      mode: options.mode,
    };
  }

  /**
   * Run the capture process
   */
  async run(): Promise<void> {
    console.log(`[Capture] Starting in ${this.options.mode} mode`);
    console.log(`[Capture] Profile directory: ${this.options.profileDir}`);
    console.log(`[Capture] Headless: ${this.options.headless}`);

    try {
      // Initialize discovery or mapper
      if (this.options.mode === 'discover') {
        this.discovery = new ShapeDiscovery();
      } else {
        this.mapper = new BookmarkMapper();
      }

      // Launch persistent context
      await this.launchBrowser();

      // Navigate to bookmarks
      const page = this.context!.pages()[0] || (await this.context!.newPage());

      console.log('[Capture] Navigating to X Bookmarks...');
      await page.goto('https://x.com/i/bookmarks', { waitUntil: 'networkidle', timeout: 60000 });

      // Check if we're logged in
      const isLoggedIn = await this.checkLogin(page);
      if (!isLoggedIn) {
        console.log('\n⚠️  Not logged in to X. Please log in manually.');
        console.log('The browser will stay open. After logging in, press Enter to continue...');

        // Wait for user to log in
        await new Promise<void>((resolve) => {
          process.stdin.once('data', () => resolve());
        });

        // Navigate to bookmarks again
        await page.goto('https://x.com/i/bookmarks', { waitUntil: 'networkidle', timeout: 60000 });
      }

      console.log('[Capture] Starting scroll...');

      // Scroll to load all bookmarks
      await this.scrollToBottom(page);

      console.log('[Capture] Scrolling complete');

      // Save results
      if (this.discovery) {
        this.discovery.saveDiscoveries();
      } else if (this.mapper) {
        this.mapper.generateReport();
      }

      console.log('\n✅ Capture complete! Files saved to ./out/');

    } catch (error) {
      console.error('[Capture] Error:', error);
      throw error;
    } finally {
      // Always close context to flush HAR
      if (this.context) {
        console.log('[Capture] Closing browser and flushing HAR...');
        await this.context.close();
      }
    }
  }

  /**
   * Launch browser with persistent context and HAR recording
   */
  private async launchBrowser(): Promise<void> {
    console.log('[Capture] Launching Chrome with persistent context...');

    this.context = await chromium.launchPersistentContext(this.options.profileDir, {
      channel: 'chrome',
      headless: this.options.headless,
      recordHar: {
        path: 'out/x-bookmarks.har.zip',
        mode: 'minimal',
        urlFilter: /\/i\/api\/graphql\//,
      },
      viewport: { width: 1280, height: 720 },
    });

    // Set up response listener
    this.context.on('response', (response) => {
      this.handleResponse(response).catch(err => {
        console.error('[Capture] Response handler error:', err);
      });
    });

    console.log('[Capture] Browser launched successfully');
  }

  /**
   * Handle GraphQL responses
   */
  private async handleResponse(response: Response): Promise<void> {
    const url = response.url();

    // Filter to GraphQL endpoints
    if (!url.includes('/i/api/graphql/')) {
      return;
    }

    // Only handle JSON responses
    const contentType = response.headers()['content-type'] || '';
    if (!contentType.includes('application/json')) {
      return;
    }

    try {
      const json = await response.json();

      // Process based on mode
      if (this.discovery) {
        this.discovery.analyzeResponse(url, json);

        // Check if we should stop discovering
        if (!this.discovery.shouldContinue()) {
          console.log('\n[Discovery] Found sufficient samples, stopping...');
          // We'll let the scroll continue but won't analyze more
        }
      } else if (this.mapper) {
        this.mapper.processResponse(url, json);
      }
    } catch (error) {
      // Ignore JSON parse errors for non-JSON responses
      if (error instanceof SyntaxError) {
        return;
      }
      console.error(`[Capture] Error processing response from ${url}:`, error);
    }
  }

  /**
   * Check if user is logged in
   */
  private async checkLogin(page: any): Promise<boolean> {
    try {
      // Wait a bit for page to load
      await page.waitForTimeout(2000);

      // Check for login indicators
      // If we see the bookmarks header, we're logged in
      const hasBookmarksHeader = await page.locator('[data-testid="primaryColumn"]').count() > 0;

      // Or check if we're on the login page
      const url = page.url();
      const isOnLoginPage = url.includes('/login') || url.includes('/i/flow/login');

      return hasBookmarksHeader && !isOnLoginPage;
    } catch {
      return false;
    }
  }

  /**
   * Scroll to bottom to load all bookmarks
   */
  private async scrollToBottom(page: any): Promise<void> {
    let scrollCount = 0;
    let noGrowthCount = 0;
    let previousStatusIds = new Set<string>();

    while (scrollCount < this.options.maxScrolls) {
      // Get current bookmark IDs
      const statusIds = await this.extractStatusIds(page);
      const currentCount = statusIds.size;

      // Check for growth
      const growth = currentCount - previousStatusIds.size;
      console.log(`[Scroll ${scrollCount + 1}] Bookmarks found: ${currentCount} (+${growth})`);

      if (growth === 0) {
        noGrowthCount++;
        console.log(`  No growth (${noGrowthCount}/${this.options.noGrowthThreshold})`);

        if (noGrowthCount >= this.options.noGrowthThreshold) {
          console.log('[Scroll] No new bookmarks for several scrolls, stopping');
          break;
        }
      } else {
        noGrowthCount = 0;
        previousStatusIds = statusIds;
      }

      // Scroll down by ~2 viewports
      await page.evaluate(() => {
        window.scrollBy(0, window.innerHeight * 2);
      });

      // Random delay to avoid rate limiting
      const delay = this.options.scrollDelay + Math.random() * 400 - 200;
      await page.waitForTimeout(delay);

      scrollCount++;

      // In discovery mode, stop early if we have enough
      if (this.discovery && !this.discovery.shouldContinue()) {
        console.log('[Scroll] Discovery complete, stopping scroll');
        break;
      }
    }

    if (scrollCount >= this.options.maxScrolls) {
      console.log('[Scroll] Reached max scroll limit');
    }

    console.log(`[Scroll] Final count: ${previousStatusIds.size} bookmarks`);
  }

  /**
   * Extract status IDs from bookmarks on page
   */
  private async extractStatusIds(page: any): Promise<Set<string>> {
    const ids = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="/status/"]'));
      return links
        .map((link: any) => {
          const match = link.href.match(/\/status\/(\d+)/);
          return match ? match[1] : null;
        })
        .filter(Boolean);
    });

    return new Set(ids);
  }
}
