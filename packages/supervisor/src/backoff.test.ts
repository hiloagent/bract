import { describe, expect, it } from 'bun:test';
import { computeBackoff } from './backoff.js';

describe('computeBackoff', () => {
  it('returns base delay for restart count 0', () => {
    const delay = computeBackoff(0, { baseDelayMs: 1000, maxBackoffMs: 300_000 });
    // base + up to 500ms jitter
    expect(delay).toBeGreaterThanOrEqual(1000);
    expect(delay).toBeLessThan(1500);
  });

  it('doubles with each restart', () => {
    // Use a fixed seed isn't possible — just verify ordering
    const d0 = computeBackoff(0, { baseDelayMs: 1000, maxBackoffMs: 300_000 });
    const d1 = computeBackoff(1, { baseDelayMs: 1000, maxBackoffMs: 300_000 });
    const d2 = computeBackoff(2, { baseDelayMs: 1000, maxBackoffMs: 300_000 });
    // d1 >= 2000 (before jitter), d2 >= 4000 (before jitter)
    expect(d1).toBeGreaterThanOrEqual(2000);
    expect(d2).toBeGreaterThanOrEqual(4000);
    // d0 < d1 with overwhelming probability (jitter is only 0–500ms)
    expect(d0).toBeLessThan(d1 + 1); // loose bound
  });

  it('caps at maxBackoffMs (plus jitter)', () => {
    const cap = 5000;
    const delay = computeBackoff(100, { baseDelayMs: 1000, maxBackoffMs: cap });
    expect(delay).toBeLessThan(cap + 500);
    expect(delay).toBeGreaterThanOrEqual(cap);
  });

  it('uses defaults when options are omitted', () => {
    const delay = computeBackoff(0);
    expect(delay).toBeGreaterThanOrEqual(1000);
    expect(delay).toBeLessThan(1500);
  });
});
