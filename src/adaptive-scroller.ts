/**
 * Adaptive Scroller
 * Dynamically adjusts scroll speed based on content loading patterns
 */

export class AdaptiveScroller {
  private baseDelay: number;
  private minDelay: number;
  private maxDelay: number;
  private recentGrowthRates: number[] = [];
  private growthWindow: number = 5;
  private currentDelay: number;

  constructor(baseDelay: number = 1000, minDelay: number = 500, maxDelay: number = 3000) {
    this.baseDelay = baseDelay;
    this.minDelay = minDelay;
    this.maxDelay = maxDelay;
    this.currentDelay = baseDelay;
  }

  /**
   * Calculate next scroll delay based on recent growth
   */
  calculateDelay(growth: number, responseTime?: number): number {
    // Track growth rate
    this.recentGrowthRates.push(growth);
    if (this.recentGrowthRates.length > this.growthWindow) {
      this.recentGrowthRates.shift();
    }

    // Need at least 2 data points
    if (this.recentGrowthRates.length < 2) {
      return this.currentDelay;
    }

    const avgGrowth = this.recentGrowthRates.reduce((a, b) => a + b, 0) / this.recentGrowthRates.length;

    // Strategy: Adjust based on growth rate
    // High growth (20+) = content loading fast, can scroll faster
    // Medium growth (5-20) = use base delay
    // Low growth (0-5) = content loading slow, slow down to give time to load

    let multiplier = 1.0;

    if (avgGrowth > 20) {
      // High growth - speed up by 20%
      multiplier = 0.8;
    } else if (avgGrowth > 10) {
      // Good growth - speed up by 10%
      multiplier = 0.9;
    } else if (avgGrowth < 3) {
      // Low growth - slow down by 50%
      multiplier = 1.5;
    } else if (avgGrowth < 5) {
      // Slow growth - slow down by 25%
      multiplier = 1.25;
    }

    // Also factor in response time if provided
    if (responseTime) {
      // If responses are slow (> 2s), increase delay
      if (responseTime > 2000) {
        multiplier *= 1.2;
      }
    }

    // Calculate new delay
    let newDelay = this.baseDelay * multiplier;

    // Apply bounds
    newDelay = Math.max(this.minDelay, Math.min(this.maxDelay, newDelay));

    // Add jitter (±10%) to appear more human-like
    const jitter = (Math.random() - 0.5) * 0.2 * newDelay;
    newDelay += jitter;

    this.currentDelay = Math.round(newDelay);

    return this.currentDelay;
  }

  /**
   * Get current delay
   */
  getCurrentDelay(): number {
    return this.currentDelay;
  }

  /**
   * Get average growth rate
   */
  getAverageGrowth(): number {
    if (this.recentGrowthRates.length === 0) return 0;
    return this.recentGrowthRates.reduce((a, b) => a + b, 0) / this.recentGrowthRates.length;
  }

  /**
   * Check if growth is stagnant
   */
  isStagnant(): boolean {
    if (this.recentGrowthRates.length < this.growthWindow) {
      return false;
    }

    // Stagnant if average growth < 1 over the window
    const avgGrowth = this.getAverageGrowth();
    return avgGrowth < 1;
  }

  /**
   * Force a specific delay (e.g., after rate limit)
   */
  setDelay(delay: number): void {
    this.currentDelay = Math.max(this.minDelay, Math.min(this.maxDelay, delay));
  }

  /**
   * Reset to base delay
   */
  reset(): void {
    this.currentDelay = this.baseDelay;
    this.recentGrowthRates = [];
  }

  /**
   * Get stats for debugging
   */
  getStats(): {
    currentDelay: number;
    avgGrowth: number;
    recentGrowth: number[];
  } {
    return {
      currentDelay: this.currentDelay,
      avgGrowth: this.getAverageGrowth(),
      recentGrowth: [...this.recentGrowthRates],
    };
  }
}
