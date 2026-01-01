/**
 * Utility functions for retry logic, async operations, and helpers
 */

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000,
  maxDelay: number = 10000
): Promise<T> {
  let lastError: Error | undefined;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (i === maxRetries - 1) {
        throw lastError;
      }

      const delay = Math.min(baseDelay * Math.pow(2, i), maxDelay);
      const jitter = Math.random() * 0.3 * delay; // Add 0-30% jitter
      const totalDelay = delay + jitter;

      console.warn(`[Retry] Attempt ${i + 1}/${maxRetries} failed: ${lastError.message}`);
      console.warn(`[Retry] Waiting ${Math.round(totalDelay)}ms before retry...`);

      await sleep(totalDelay);
    }
  }

  throw lastError!;
}

/**
 * Parse JSON with retry logic
 */
export async function parseJSONWithRetry(
  getText: () => Promise<string>,
  maxRetries: number = 3
): Promise<any> {
  return retryWithBackoff(async () => {
    const text = await getText();
    return JSON.parse(text);
  }, maxRetries);
}

/**
 * Format duration in human-readable format
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Format bytes in human-readable format
 */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * Get file extension from media type
 */
export function getMediaExtension(type: string): string {
  switch (type) {
    case 'photo':
      return 'jpg';
    case 'video':
      return 'mp4';
    case 'animated_gif':
      return 'gif';
    default:
      return 'jpg';
  }
}

/**
 * Ensure directory exists
 */
export async function ensureDir(dir: string): Promise<void> {
  const { mkdir } = await import('fs/promises');
  await mkdir(dir, { recursive: true });
}
