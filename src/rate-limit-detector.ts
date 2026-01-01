/**
 * Rate Limit Detector
 * Detects when X is rate limiting or throttling requests
 */

export interface RateLimitStatus {
  isRateLimited: boolean;
  message?: string;
  suggestedWaitMs?: number;
}

export class RateLimitDetector {
  private consecutiveEmpty: number = 0;
  private emptyThreshold: number = 3;
  private consecutiveErrors: number = 0;
  private errorThreshold: number = 5;
  private recentResponseSizes: number[] = [];
  private sizeWindow: number = 10;

  /**
   * Check if a response indicates rate limiting
   */
  checkResponse(response: any, entriesCount: number = 0): RateLimitStatus {
    // Track response sizes to detect throttling
    if (response) {
      const size = JSON.stringify(response).length;
      this.recentResponseSizes.push(size);
      if (this.recentResponseSizes.length > this.sizeWindow) {
        this.recentResponseSizes.shift();
      }
    }

    // Check for explicit rate limit errors in response
    if (response?.errors) {
      const rateLimitError = response.errors.find((e: any) =>
        e.code === 88 || // Rate limit exceeded
        e.code === 130 || // Over capacity
        e.message?.toLowerCase().includes('rate limit') ||
        e.message?.toLowerCase().includes('too many requests')
      );

      if (rateLimitError) {
        return {
          isRateLimited: true,
          message: `API rate limit error: ${rateLimitError.message || 'Rate limit exceeded'}`,
          suggestedWaitMs: 900000, // 15 minutes
        };
      }
    }

    // Check for consecutive empty responses
    if (entriesCount === 0) {
      this.consecutiveEmpty++;
      this.consecutiveErrors = 0; // Reset error count on empty
    } else {
      this.consecutiveEmpty = 0;
      this.consecutiveErrors = 0;
    }

    if (this.consecutiveEmpty >= this.emptyThreshold) {
      return {
        isRateLimited: true,
        message: `Detected ${this.consecutiveEmpty} consecutive empty responses - likely rate limited`,
        suggestedWaitMs: 300000, // 5 minutes
      };
    }

    // Check for suspiciously small responses (could indicate throttling)
    if (this.recentResponseSizes.length >= this.sizeWindow) {
      const avgSize = this.recentResponseSizes.reduce((a, b) => a + b, 0) / this.recentResponseSizes.length;
      const lastSize = this.recentResponseSizes[this.recentResponseSizes.length - 1];

      // If last response is < 20% of average, might be throttled
      if (lastSize < avgSize * 0.2 && avgSize > 1000) {
        console.warn(`[RateLimit] Response size dropped significantly (${lastSize} vs avg ${avgSize.toFixed(0)})`);
      }
    }

    return { isRateLimited: false };
  }

  /**
   * Record a failed request
   */
  recordError(): void {
    this.consecutiveErrors++;
  }

  /**
   * Check if too many errors occurred
   */
  hasTooManyErrors(): boolean {
    return this.consecutiveErrors >= this.errorThreshold;
  }

  /**
   * Reset the detector state
   */
  reset(): void {
    this.consecutiveEmpty = 0;
    this.consecutiveErrors = 0;
    this.recentResponseSizes = [];
  }

  /**
   * Get current status summary
   */
  getStatus(): {
    consecutiveEmpty: number;
    consecutiveErrors: number;
    avgResponseSize: number;
  } {
    const avgSize = this.recentResponseSizes.length > 0
      ? this.recentResponseSizes.reduce((a, b) => a + b, 0) / this.recentResponseSizes.length
      : 0;

    return {
      consecutiveEmpty: this.consecutiveEmpty,
      consecutiveErrors: this.consecutiveErrors,
      avgResponseSize: avgSize,
    };
  }
}
