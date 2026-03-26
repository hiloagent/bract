/**
 * @file backoff.ts
 * Exponential backoff calculation for supervisor restart delays.
 * @module @losoft/bract-supervisor/backoff
 */
export interface BackoffOptions {
  baseDelayMs?: number;
  maxBackoffMs?: number;
}

/**
 * Compute exponential backoff delay with random jitter (0–500ms).
 *
 * delay = min(base * 2^restartCount, max) + jitter
 *
 * @param restartCount  Number of restarts that have already happened.
 * @param options       baseDelayMs (default 1000), maxBackoffMs (default 300_000).
 */
export function computeBackoff(
  restartCount: number,
  options: BackoffOptions = {},
): number {
  const base = options.baseDelayMs ?? 1_000;
  const cap = options.maxBackoffMs ?? 300_000;
  const jitter = Math.random() * 500;
  return Math.min(base * Math.pow(2, restartCount), cap) + jitter;
}
