/**
 * @file join-router.ts
 * Runtime join router — waits for one message from each source, then delivers them combined.
 *
 * A JoinRouter watches the outbox directories of all source agents and buffers
 * messages per source in a per-join queue. Once every source has contributed at
 * least one message, the oldest from each queue is combined into a single JSON
 * message and delivered to the target agent's inbox.
 *
 * Queue state is persisted in `{to}/.join-queue/{joinKey}/{source}/` so the
 * router is restart-safe. Source messages are marked in
 * `outbox/.piped/{joinKey}/` to avoid double-enqueueing.
 *
 * @module @losoft/bract-runtime/join-router
 */
import { mkdirSync, existsSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { read, send } from './message.js';

export interface JoinPipeDef {
  mode: 'join';
  /** Source agent names — all must contribute before delivery. */
  from: string[];
  /** Target agent name whose inbox receives the combined message. */
  to: string;
}

export interface JoinRouterOptions {
  /** How often to poll, in milliseconds. Default: 200 */
  pollIntervalMs?: number;
}

/**
 * JoinRouter implements the `join` (zip) pipe operator.
 *
 * For each join definition it:
 *   1. Scans each source's outbox for new messages and enqueues them.
 *   2. When every source has at least one queued message, dequeues the
 *      oldest from each, combines their bodies into a JSON object keyed by
 *      source name, and delivers a single message to the target inbox.
 *
 * @example
 * ```ts
 * const router = new JoinRouter('/var/bract/agents', [
 *   { mode: 'join', from: ['fetcher-a', 'fetcher-b'], to: 'aggregator' },
 * ]);
 * router.start();
 * ```
 */
export class JoinRouter {
  private readonly agentsRoot: string;
  private readonly pipes: JoinPipeDef[];
  private readonly pollIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(agentsRoot: string, pipes: JoinPipeDef[], options: JoinRouterOptions = {}) {
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

  /** Perform one full poll across all join pipes. Exposed for testing. */
  async poll(): Promise<void> {
    for (const pipe of this.pipes) {
      await this.pollJoin(pipe);
    }
  }

  /**
   * Stable join key derived from sorted source names and target.
   * Used as the marker directory name and queue subdirectory name.
   */
  private joinKey(pipe: JoinPipeDef): string {
    const sources = [...pipe.from].sort().join('+');
    return `join-${pipe.to}-${sources}`;
  }

  private async pollJoin(pipe: JoinPipeDef): Promise<void> {
    const key = this.joinKey(pipe);

    for (const source of pipe.from) {
      await this.enqueueNew(source, pipe, key);
    }

    // Deliver as many complete sets as possible
    let delivered = true;
    while (delivered) {
      delivered = await this.tryDeliver(pipe, key);
    }
  }

  /** Scan source outbox for new messages and append them to the join queue. */
  private async enqueueNew(source: string, pipe: JoinPipeDef, key: string): Promise<void> {
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

      // Append to join queue
      const queueDir = join(this.agentsRoot, pipe.to, '.join-queue', key, source);
      mkdirSync(queueDir, { recursive: true });

      const queuePath = join(queueDir, filename);
      if (!existsSync(queuePath)) {
        await Bun.write(queuePath, JSON.stringify(msg, null, 2) + '\n');
      }

      // Mark as enqueued so we don't add it again on restart
      mkdirSync(pipedDir, { recursive: true });
      writeFileSync(markerPath, '', 'utf8');
    }
  }

  /**
   * If all source queues have at least one message, dequeue the oldest from
   * each, combine them, and deliver to the target inbox.
   *
   * Returns true if a message was delivered (caller should loop to drain).
   */
  private async tryDeliver(pipe: JoinPipeDef, key: string): Promise<boolean> {
    const dequeue: Array<{ source: string; dir: string; filename: string }> = [];

    for (const source of pipe.from) {
      const queueDir = join(this.agentsRoot, pipe.to, '.join-queue', key, source);
      if (!existsSync(queueDir)) return false;

      const files = readdirSync(queueDir)
        .filter((f) => f.endsWith('.msg'))
        .sort();

      if (files.length === 0) return false;

      dequeue.push({ source, dir: queueDir, filename: files[0]! });
    }

    // Read all queued messages
    const bodies: Record<string, string> = {};
    for (const { source, dir, filename } of dequeue) {
      let msg;
      try {
        msg = await read(dir, filename);
      } catch {
        return false;
      }
      bodies[source] = msg.body;
    }

    // Deliver combined message
    const targetInboxDir = join(this.agentsRoot, pipe.to, 'inbox');
    try {
      await send(targetInboxDir, '__join__', JSON.stringify(bodies), {
        joinFrom: pipe.from,
        joinKey: key,
      });
    } catch {
      // Inbox not ready — don't remove from queue, retry next poll
      return false;
    }

    // Remove delivered entries from queues
    for (const { dir, filename } of dequeue) {
      try {
        unlinkSync(join(dir, filename));
      } catch {
        // Best effort
      }
    }

    return true;
  }
}
