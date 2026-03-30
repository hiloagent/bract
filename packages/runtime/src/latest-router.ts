/**
 * @file latest-router.ts
 * Runtime latest router — delivers a combined message whenever any source produces output.
 *
 * A LatestRouter (combineLatest semantics) watches the outbox directories of
 * all source agents, keeps track of the most recent message from each, and
 * delivers a combined JSON message to the target inbox whenever any source
 * produces a new message — as long as every source has produced at least one.
 *
 * State is persisted in `{to}/.latest-state/{latestKey}/{source}.latest` so
 * the router is restart-safe. Source messages are marked in
 * `outbox/.piped/{latestKey}/` to avoid double-processing.
 *
 * @module @losoft/bract-runtime/latest-router
 */
import { mkdirSync, existsSync, readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { read, send } from './message.js';

export interface LatestPipeDef {
  mode: 'latest';
  /** Source agent names — all must have contributed at least once before delivery. */
  from: string[];
  /** Target agent name whose inbox receives combined messages. */
  to: string;
}

export interface LatestRouterOptions {
  /** How often to poll, in milliseconds. Default: 200 */
  pollIntervalMs?: number;
}

/**
 * LatestRouter implements the `latest` (combineLatest) pipe operator.
 *
 * For each pipe definition it:
 *   1. Scans each source's outbox for unprocessed messages.
 *   2. For each new message, updates the stored "latest" for that source.
 *   3. If all sources now have a stored latest, delivers a combined message
 *      to the target inbox — one delivery per new message received.
 *
 * @example
 * ```ts
 * const router = new LatestRouter('/var/bract/agents', [
 *   { mode: 'latest', from: ['price-feed', 'news-feed'], to: 'monitor' },
 * ]);
 * router.start();
 * ```
 */
export class LatestRouter {
  private readonly agentsRoot: string;
  private readonly pipes: LatestPipeDef[];
  private readonly pollIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(agentsRoot: string, pipes: LatestPipeDef[], options: LatestRouterOptions = {}) {
    this.agentsRoot = agentsRoot;
    this.pipes = pipes;
    this.pollIntervalMs = options.pollIntervalMs ?? 200;
  }

  /** Start polling. Safe to call multiple times — subsequent calls are no-ops. */
  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => void this.poll(), this.pollIntervalMs);
    if (this.timer.unref) this.timer.unref();
  }

  /** Stop polling. */
  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Returns true if the router is currently running. */
  get running(): boolean {
    return this.timer !== null;
  }

  /** Perform one full poll across all latest pipes. Exposed for testing. */
  async poll(): Promise<void> {
    for (const pipe of this.pipes) {
      await this.pollLatest(pipe);
    }
  }

  /**
   * Stable key derived from sorted source names and target.
   * Used as the marker directory name and state subdirectory name.
   */
  private latestKey(pipe: LatestPipeDef): string {
    const sources = [...pipe.from].sort().join('+');
    return `latest-${pipe.to}-${sources}`;
  }

  private async pollLatest(pipe: LatestPipeDef): Promise<void> {
    const key = this.latestKey(pipe);

    for (const source of pipe.from) {
      await this.processSource(source, pipe, key);
    }
  }

  /**
   * Scan source outbox for new messages. For each new message:
   * - Update the stored latest for that source.
   * - If all sources have a stored latest, deliver combined message.
   */
  private async processSource(source: string, pipe: LatestPipeDef, key: string): Promise<void> {
    const outboxDir = join(this.agentsRoot, source, 'outbox');
    if (!existsSync(outboxDir)) return;

    let files: string[];
    try {
      files = readdirSync(outboxDir)
        .filter((f) => f.endsWith('.msg'))
        .sort();
    } catch {
      return;
    }

    for (const filename of files) {
      const pipedDir = join(outboxDir, '.piped', key);
      const markerPath = join(pipedDir, filename);

      if (existsSync(markerPath)) continue;

      let msg;
      try {
        msg = await read(outboxDir, filename);
      } catch {
        continue;
      }

      // Update stored latest for this source
      const stateDir = join(this.agentsRoot, pipe.to, '.latest-state', key);
      mkdirSync(stateDir, { recursive: true });
      const latestPath = join(stateDir, `${source}.latest`);
      writeFileSync(latestPath, msg.body, 'utf8');

      // Mark this message as processed for this key
      mkdirSync(pipedDir, { recursive: true });
      writeFileSync(markerPath, '', 'utf8');

      // Deliver combined message if all sources have a latest
      await this.maybeDeliver(pipe, key, stateDir);
    }
  }

  /**
   * If all sources have a stored latest value, deliver a combined message
   * to the target inbox. A combined message is a JSON object keyed by source name.
   */
  private async maybeDeliver(pipe: LatestPipeDef, key: string, stateDir: string): Promise<void> {
    const bodies: Record<string, string> = {};

    for (const source of pipe.from) {
      const latestPath = join(stateDir, `${source}.latest`);
      if (!existsSync(latestPath)) return;
      try {
        bodies[source] = readFileSync(latestPath, 'utf8');
      } catch {
        return;
      }
    }

    const targetInboxDir = join(this.agentsRoot, pipe.to, 'inbox');
    try {
      await send(targetInboxDir, '__latest__', JSON.stringify(bodies), {
        latestFrom: pipe.from,
        latestKey: key,
      });
    } catch {
      // Inbox not ready — state is already saved, will deliver on next trigger
    }
  }
}
