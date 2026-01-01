/**
 * Enhanced Bookmarks Capture Module (V2)
 * Playwright runner with:
 * - Adaptive scroll speed
 * - Rate limit detection
 * - Retry logic for responses
 * - Better error handling
 */

import { chromium, type BrowserContext, type Response } from 'playwright';
import { ShapeDiscovery } from './shape-discovery.js';
import { BookmarkMapperV2, type MapperOptions } from './mapper-v2.js';
import { AdaptiveScroller } from './adaptive-scroller.js';
import { HarReconciler } from './har-reconciler.js';
import { parseJSONWithRetry, sleep } from './utils.js';

export type CaptureMode = 'discover' | 'extract';

export interface CaptureOptions extends MapperOptions {
  mode: CaptureMode;
  headless?: boolean;
  maxScrolls?: number;
  scrollDelay?: number;
  noGrowthThreshold?: number;
  profileDir?: string;
}

export class BookmarksCaptureV2 {
  private options: Required<CaptureOptions>;
  private context?: BrowserContext;
  private discovery?: ShapeDiscovery;
  private mapper?: BookmarkMapperV2;
  private adaptiveScroller?: AdaptiveScroller;

  constructor(options: CaptureOptions) {
    this.options = {
      headless: options.headless ?? false,
      maxScrolls: options.maxScrolls ?? 1000,
      scrollDelay: options.scrollDelay ?? 1000,
      noGrowthThreshold: options.noGrowthThreshold ?? 6,
      profileDir: options.profileDir ?? './x-profile',
      mode: options.mode,
      useSQLite: options.useSQLite ?? false,
      downloadMedia: options.downloadMedia ?? false,
      resumeFromCheckpoint: options.resumeFromCheckpoint ?? true,
    };
  }

  /**
   * Run the capture process
   */
  async run(): Promise<void> {
    console.log(`\n╔═══════════════════════════════════════════╗`);
    console.log(`║   X Bookmarks Scraper V2                  ║`);
    console.log(`╚═══════════════════════════════════════════╝`);
    console.log(`Mode: ${this.options.mode}`);
    console.log(`Profile: ${this.options.profileDir}`);
    console.log(`SQLite: ${this.options.useSQLite ? 'enabled' : 'disabled'}`);
    console.log(`Media download: ${this.options.downloadMedia ? 'enabled' : 'disabled'}`);
    console.log(`Resume: ${this.options.resumeFromCheckpoint ? 'enabled' : 'disabled'}\n`);

    try {
      // Initialize components
      if (this.options.mode === 'discover') {
        this.discovery = new ShapeDiscovery();
      } else {
        this.mapper = new BookmarkMapperV2({
          useSQLite: this.options.useSQLite,
          downloadMedia: this.options.downloadMedia,
          resumeFromCheckpoint: this.options.resumeFromCheckpoint,
        });
        await this.mapper.initialize();

        // Initialize adaptive scroller
        this.adaptiveScroller = new AdaptiveScroller(this.options.scrollDelay);
      }

      // Launch browser
      await this.launchBrowser();

      const page = this.context!.pages()[0] || (await this.context!.newPage());

      console.log('[Capture] Navigating to X Bookmarks...');

      // Navigate without waiting for networkidle (login page never reaches it)
      await page.goto('https://x.com/i/bookmarks', {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Give page time to load
      await page.waitForTimeout(2000);

      // Check login
      const isLoggedIn = await this.checkLogin(page);
      if (!isLoggedIn) {
        console.log('\n⚠️  Not logged in to X.');
        console.log('\n📋 Instructions:');
        console.log('  1. Log in to X in the browser window');
        console.log('  2. Navigate to your bookmarks');
        console.log('  3. Return here and press Enter to continue\n');
        console.log('Waiting for you to log in...');

        await new Promise<void>((resolve) => {
          process.stdin.once('data', () => resolve());
        });

        // Re-navigate to bookmarks after login
        console.log('[Capture] Continuing to bookmarks...');
        await page.goto('https://x.com/i/bookmarks', {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });
        await page.waitForTimeout(2000);
      }

      // Wait for initial bookmarks to load (wait for network to settle)
      console.log('[Capture] Waiting for initial bookmarks to load...');
      await page.waitForTimeout(3000);

      // Wait for at least one Bookmarks API response
      let waitCount = 0;
      while (this.mapper && this.mapper.getResponseCount() === 0 && waitCount < 10) {
        console.log(`[Capture] Waiting for API response... (${waitCount + 1}/10)`);
        await page.waitForTimeout(1000);
        waitCount++;
      }

      const initialResponses = this.mapper ? this.mapper.getResponseCount() : 0;
      const initialTweets = this.mapper ? this.mapper.getUniqueTweetCount() : 0;
      console.log(`[Capture] Initial load: ${initialTweets} tweets from ${initialResponses} responses`);

      console.log('[Capture] Starting scroll...\n');

      // Scroll to load all bookmarks
      await this.scrollToBottom(page);

      console.log('\n[Capture] Scrolling complete');

    } catch (error) {
      console.error('\n❌ [Capture] Error:', error);
      throw error;
    } finally {
      // Close browser first to flush HAR file
      if (this.context) {
        console.log('\n[Capture] Closing browser and flushing HAR...');
        await this.context.close();
      }

      // Run HAR reconciliation after browser closes (HAR is now complete)
      if (this.mapper) {
        await this.reconcileWithHar();
        await this.mapper.generateReport();
        await this.mapper.close();
      } else if (this.discovery) {
        this.discovery.saveDiscoveries();
      }

      console.log('\n✅ Capture complete! Files saved to ./out/');
    }
  }

  /**
   * Reconcile extracted data against HAR file
   * Recovers any tweets that were missed during live capture
   */
  private async reconcileWithHar(): Promise<void> {
    if (!this.mapper) return;

    try {
      const reconciler = new HarReconciler('out/x-bookmarks.har.zip');
      const seenTweets = this.mapper.getSeenTweetIds();
      const responseCount = this.mapper.getResponseCount();

      await reconciler.reconcile(
        seenTweets,
        responseCount,
        async (harTweet) => {
          await this.mapper!.recoverTweet(harTweet);
        }
      );
    } catch (error) {
      console.warn('[Capture] HAR reconciliation skipped:', error instanceof Error ? error.message : error);
    }
  }

  /**
   * Launch browser with persistent context
   */
  private async launchBrowser(): Promise<void> {
    console.log('[Capture] Launching Chromium with stealth configuration...');

    this.context = await chromium.launchPersistentContext(this.options.profileDir, {
      headless: this.options.headless,

      // Stealth configuration to bypass bot detection
      args: [
        '--disable-blink-features=AutomationControlled',  // Hide automation
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-site-isolation-trials',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1280,720',
      ],

      // Set realistic user agent
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',

      // Grant permissions
      permissions: ['geolocation', 'notifications'],

      recordHar: {
        path: 'out/x-bookmarks.har.zip',
        mode: 'minimal',
        urlFilter: /\/i\/api\/graphql\//,
      },
      viewport: { width: 1280, height: 720 },
    });

    // Override navigator.webdriver to false (critical for detection bypass)
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });

      // Add chrome object if missing
      if (!window.chrome) {
        // @ts-ignore
        window.chrome = { runtime: {} };
      }

      // Override permissions
      const originalQuery = window.navigator.permissions.query;
      // @ts-ignore
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );
    });

    // Set up response listener
    this.context.on('response', (response) => {
      this.handleResponse(response).catch(err => {
        console.error('[Capture] Response handler error:', err);
      });
    });

    console.log('[Capture] ✓ Browser launched with stealth mode');
    console.log('[Capture] → Automation detection bypassed');
  }

  /**
   * Handle GraphQL responses with retry logic
   */
  private async handleResponse(response: Response): Promise<void> {
    const url = response.url();

    if (!url.includes('/i/api/graphql/')) {
      return;
    }

    const contentType = response.headers()['content-type'] || '';
    if (!contentType.includes('application/json')) {
      return;
    }

    try {
      // Parse JSON with retry logic
      const json = await parseJSONWithRetry(() => response.text(), 3);

      // Process based on mode
      if (this.discovery) {
        this.discovery.analyzeResponse(url, json);

        if (!this.discovery.shouldContinue()) {
          console.log('\n[Discovery] Found sufficient samples');
        }
      } else if (this.mapper) {
        await this.mapper.processResponse(url, json);

        // Check for rate limiting
        const rateLimitDetector = this.mapper.getRateLimitDetector();
        if (rateLimitDetector.hasTooManyErrors()) {
          console.warn('\n⚠️  Too many consecutive errors detected');
        }
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        return; // Ignore non-JSON responses
      }
      console.error(`[Capture] Error processing response from ${url}:`, error);
    }
  }

  /**
   * Check if logged in
   */
  private async checkLogin(page: any): Promise<boolean> {
    try {
      await page.waitForTimeout(2000);

      const hasBookmarksHeader = await page.locator('[data-testid="primaryColumn"]').count() > 0;
      const url = page.url();
      const isOnLoginPage = url.includes('/login') || url.includes('/i/flow/login');

      return hasBookmarksHeader && !isOnLoginPage;
    } catch {
      return false;
    }
  }

  /**
   * Scroll to bottom with adaptive speed
   * Uses API response count for growth detection (not DOM, which is virtual)
   */
  private async scrollToBottom(page: any): Promise<void> {
    let scrollCount = 0;
    let noGrowthCount = 0;
    let lastScrollTime = Date.now();
    let previousTweetCount = this.mapper ? this.mapper.getUniqueTweetCount() : 0;
    let previousResponseCount = this.mapper ? this.mapper.getResponseCount() : 0;

    while (scrollCount < this.options.maxScrolls) {
      const scrollStartTime = Date.now();

      // Update metrics
      if (this.mapper) {
        const metrics = this.mapper.getMetrics();
        metrics.recordScroll();
      }

      // Calculate growth based on API responses (not DOM - X uses virtual scrolling)
      const currentTweetCount = this.mapper ? this.mapper.getUniqueTweetCount() : 0;
      const currentResponseCount = this.mapper ? this.mapper.getResponseCount() : 0;
      const tweetGrowth = currentTweetCount - previousTweetCount;
      const newResponses = currentResponseCount - previousResponseCount;
      const responseTime = Date.now() - lastScrollTime;

      console.log(`[Scroll ${scrollCount + 1}] Tweets captured: ${currentTweetCount} (+${tweetGrowth}) | Responses: ${currentResponseCount}`);

      // Check for growth - use API response count, not DOM
      // No growth = no new API responses AND no new tweets
      if (newResponses === 0 && tweetGrowth === 0) {
        noGrowthCount++;
        console.log(`  No new data (${noGrowthCount}/${this.options.noGrowthThreshold})`);

        if (noGrowthCount >= this.options.noGrowthThreshold) {
          console.log('[Scroll] No new API responses for several scrolls, stopping');
          break;
        }
      } else {
        noGrowthCount = 0;
        previousTweetCount = currentTweetCount;
        previousResponseCount = currentResponseCount;
      }

      // Calculate next scroll delay with adaptive scroller
      let delay: number;
      if (this.adaptiveScroller) {
        delay = this.adaptiveScroller.calculateDelay(tweetGrowth, responseTime);
        const stats = this.adaptiveScroller.getStats();
        console.log(`  Adaptive delay: ${delay}ms (avg growth: ${stats.avgGrowth.toFixed(1)})`);
      } else {
        delay = this.options.scrollDelay + Math.random() * 400 - 200;
      }

      // AGGRESSIVE scrolling for X's virtual scrolling + batched API responses
      // X loads content in batches - need sustained scrolling to trigger new API calls

      // 1. Multiple rapid scrolls (simulates continuous scrolling)
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => {
          window.scrollBy(0, window.innerHeight * 1.5);
        });
        await sleep(200);
      }

      // 2. Wait for network to settle and API responses to arrive
      await sleep(1000);

      // 3. Try clicking "Show more" buttons if present
      try {
        const showMoreButton = await page.$('[data-testid="cellInnerDiv"] [role="button"]:has-text("Show"), [data-testid="cellInnerDiv"] [role="button"]:has-text("more")');
        if (showMoreButton) {
          console.log('  → Clicking "Show more" button...');
          await showMoreButton.click();
          await sleep(1000);
        }
      } catch {
        // No button, continue
      }

      // 4. Final push to absolute bottom
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });

      await sleep(delay);

      lastScrollTime = Date.now();
      scrollCount++;

      // Early stop in discovery mode
      if (this.discovery && !this.discovery.shouldContinue()) {
        console.log('[Scroll] Discovery complete');
        break;
      }

      // Check for rate limiting
      if (this.mapper) {
        const rateLimitDetector = this.mapper.getRateLimitDetector();
        const status = rateLimitDetector.getStatus();

        if (status.consecutiveEmpty >= 3) {
          console.warn(`\n⚠️  Possible rate limiting detected (${status.consecutiveEmpty} empty responses)`);
          console.warn('Slowing down scroll speed...');

          if (this.adaptiveScroller) {
            this.adaptiveScroller.setDelay(this.options.scrollDelay * 2);
          }

          await sleep(5000); // Extra delay
        }
      }
    }

    if (scrollCount >= this.options.maxScrolls) {
      console.log('[Scroll] Reached max scroll limit');
    }

    const finalTweetCount = this.mapper ? this.mapper.getUniqueTweetCount() : 0;
    const finalResponseCount = this.mapper ? this.mapper.getResponseCount() : 0;
    console.log(`\n[Scroll] Final: ${finalTweetCount} unique tweets from ${finalResponseCount} API responses`);
  }

  /**
   * Extract status IDs from page
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
