import { EventEmitter } from 'node:events';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { listPending, consume, Message } from './message.js';

export interface InboxWatcherOptions {
  /** How often to poll, in milliseconds. Default: 200 */
  pollIntervalMs?: number;
}

export interface MessageEvent {
  agentName: string;
  filename: string;
  message: Message;
}

export interface InboxErrorEvent {
  agentName: string;
  filename: string;
  error: unknown;
}

/**
 * InboxWatcher polls agent inbox directories at a regular interval.
 * When a new .msg file appears it emits a 'message' event and moves the
 * file to inbox/.processed/ to prevent re-delivery.
 *
 * @example
 * ```ts
 * const table = new ProcessTable('/var/bract');
 * const watcher = new InboxWatcher(table.root, { pollIntervalMs: 100 });
 *
 * watcher.on('message', ({ agentName, message }) => {
 *   console.log(`[${agentName}] ${message.from}: ${message.body}`);
 * });
 *
 * watcher.start();
 * ```
 */
export class InboxWatcher extends EventEmitter {
  protected readonly root: string;
  private readonly pollIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  /** `root` is the `agents/` directory — the same as `ProcessTable.root`. */
  constructor(agentsRoot: string, options: InboxWatcherOptions = {}) {
    super();
    this.root = agentsRoot;
    this.pollIntervalMs = options.pollIntervalMs ?? 200;
  }

  /** Start polling. Safe to call multiple times — subsequent calls are no-ops. */
  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.poll(), this.pollIntervalMs);
    // Allow the process to exit even if the watcher is still running.
    if (this.timer.unref) this.timer.unref();
  }

  /** Stop polling. */
  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Returns true if the watcher is currently running. */
  get running(): boolean {
    return this.timer !== null;
  }

  /** Perform a single poll across all known agents. */
  poll(): void {
    if (!existsSync(this.root)) return;

    let agents: string[];
    try {
      agents = readdirSync(this.root, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      return;
    }

    for (const agentName of agents) {
      void this.pollAgent(agentName);
    }
  }

  protected async pollAgent(agentName: string): Promise<void> {
    const inboxDir = join(this.root, agentName, 'inbox');
    const pending = listPending(inboxDir);
    for (const filename of pending) {
      try {
        const message = await consume(inboxDir, filename);
        const event: MessageEvent = { agentName, filename, message };
        this.emit('message', event);
      } catch (err) {
        const errEvent: InboxErrorEvent = { agentName, filename, error: err };
        this.emit('error', errEvent);
      }
    }
  }

  /**
   * Create a watcher scoped to a single agent's inbox.
   * Useful when you only manage one agent per process.
   */
  static forAgent(
    agentsRoot: string,
    agentName: string,
    options: InboxWatcherOptions = {},
  ): InboxWatcher {
    return new SingleAgentWatcher(agentsRoot, agentName, options);
  }
}

/** InboxWatcher variant that only watches one named agent's inbox. */
class SingleAgentWatcher extends InboxWatcher {
  private readonly agentName: string;

  constructor(agentsRoot: string, agentName: string, options: InboxWatcherOptions) {
    super(agentsRoot, options);
    this.agentName = agentName;
  }

  override poll(): void {
    this.pollAgent(this.agentName);
  }
}
