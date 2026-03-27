/**
 * @file pipe-router.ts
 * Runtime pipe router — forwards messages from one agent's outbox to another's inbox.
 *
 * A PipeRouter watches the outbox directories of source agents and forwards
 * new messages to target agent inboxes, respecting optional filter substrings.
 * Forwarded messages are tracked in `outbox/.piped/{to}/` so the router is
 * restart-safe and never delivers a message twice.
 *
 * @module @losoft/bract-runtime/pipe-router
 */
import { mkdirSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { read, send } from './message.js';

export interface PipeDef {
  /** Source agent name — whose outbox to watch. */
  from: string;
  /** Target agent name — whose inbox to forward into. */
  to: string;
  /** Only forward messages whose body contains this substring. Optional. */
  filter?: string;
}

export interface PipeRouterOptions {
  /** How often to poll outbox directories, in milliseconds. Default: 200 */
  pollIntervalMs?: number;
}

/**
 * PipeRouter watches source agent outbox directories and forwards new messages
 * to target agent inboxes, supporting optional substring filters.
 *
 * Messages already forwarded are tracked via marker files in
 * `outbox/.piped/{target}/` so the router is safe to restart.
 *
 * @example
 * ```ts
 * const router = new PipeRouter('/var/bract/agents', [
 *   { from: 'classifier', to: 'responder' },
 *   { from: 'classifier', to: 'logger', filter: 'ERROR' },
 * ]);
 * router.start();
 * ```
 */
export class PipeRouter {
  private readonly agentsRoot: string;
  private readonly pipes: PipeDef[];
  private readonly pollIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(agentsRoot: string, pipes: PipeDef[], options: PipeRouterOptions = {}) {
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

  /** Perform one full poll across all pipes. Exposed for testing. */
  async poll(): Promise<void> {
    // Group pipes by source so we scan each outbox once per poll
    const bySource = new Map<string, PipeDef[]>();
    for (const pipe of this.pipes) {
      const list = bySource.get(pipe.from) ?? [];
      list.push(pipe);
      bySource.set(pipe.from, list);
    }

    for (const [source, defs] of bySource) {
      await this.pollSource(source, defs);
    }
  }

  private async pollSource(source: string, defs: PipeDef[]): Promise<void> {
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
      for (const def of defs) {
        await this.maybeForward(outboxDir, filename, def);
      }
    }
  }

  private async maybeForward(outboxDir: string, filename: string, def: PipeDef): Promise<void> {
    const pipedDir = join(outboxDir, '.piped', def.to);
    const markerPath = join(pipedDir, filename);

    // Skip if already forwarded
    if (existsSync(markerPath)) return;

    let msg;
    try {
      msg = await read(outboxDir, filename);
    } catch {
      // Unreadable or corrupt message — skip without marking
      return;
    }

    // Apply filter
    if (def.filter !== undefined && !msg.body.includes(def.filter)) {
      // Not a match — mark as seen so we don't re-check on every poll
      mkdirSync(pipedDir, { recursive: true });
      writeFileSync(markerPath, '', 'utf8');
      return;
    }

    // Forward to target inbox
    const targetInboxDir = join(this.agentsRoot, def.to, 'inbox');
    try {
      await send(targetInboxDir, msg.from, msg.body, { ...msg.metadata, pipedFrom: def.from });
    } catch {
      // Inbox not ready yet — don't mark, retry next poll
      return;
    }

    // Mark as forwarded
    mkdirSync(pipedDir, { recursive: true });
    writeFileSync(markerPath, '', 'utf8');
  }
}
