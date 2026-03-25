import { EventEmitter } from 'node:events';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProcessTable } from '@losoft/bract-runtime';
import { computeBackoff, type BackoffOptions } from './backoff.js';
import { writeCrashRecord } from './crash-record.js';

export type RestartPolicy = 'always' | 'on-failure' | 'never';

export interface AgentRegistration {
  name: string;
  restart?: RestartPolicy;
  /**
   * Called by the supervisor to (re)spawn the agent.
   * Must resolve to the new OS PID.
   */
  spawn: () => Promise<number> | number;
}

export interface SupervisorOptions extends BackoffOptions {
  /** How often to poll for dead agents. Default: 5000ms. */
  heartbeatIntervalMs?: number;
  /** Maximum restarts within the reset window before giving up. Default: 10. */
  maxRestarts?: number;
  /** Window (ms) in which restarts are counted. Default: 3_600_000 (1 hour). */
  resetWindowMs?: number;
}

export interface AgentDiedEvent {
  name: string;
  pid: number;
  exitCode: number | null;
}

export interface AgentRestartedEvent {
  name: string;
  newPid: number;
  restartCount: number;
}

export interface AgentExhaustedEvent {
  name: string;
  restartCount: number;
}

interface AgentState {
  reg: AgentRegistration;
  /** Timestamps (ms) of recent restarts within the reset window. */
  restartHistory: number[];
  pendingRestart: ReturnType<typeof setTimeout> | null;
}

/**
 * Supervisor watches registered agents by polling their OS PIDs.
 * On crash it applies the agent's restart policy and writes a crash record
 * to `agents/{name}/crashes/`.
 *
 * @example
 * ```ts
 * const sup = new Supervisor('/var/bract');
 * sup.register({
 *   name: 'my-agent',
 *   restart: 'always',
 *   spawn: () => spawnAgentProcess('my-agent'),
 * });
 * sup.on('agent:died', ({ name, pid }) => console.log(`${name} (pid ${pid}) died`));
 * sup.start();
 * ```
 */
export class Supervisor extends EventEmitter {
  private readonly table: ProcessTable;
  private readonly home: string;
  private readonly opts: Required<SupervisorOptions>;
  private readonly agents = new Map<string, AgentState>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(home: string, options: SupervisorOptions = {}) {
    super();
    this.home = home;
    this.table = new ProcessTable(home);
    this.opts = {
      heartbeatIntervalMs: options.heartbeatIntervalMs ?? 5_000,
      baseDelayMs: options.baseDelayMs ?? 1_000,
      maxBackoffMs: options.maxBackoffMs ?? 300_000,
      maxRestarts: options.maxRestarts ?? 10,
      resetWindowMs: options.resetWindowMs ?? 3_600_000,
    };
  }

  /** Register an agent for supervision. Throws if the name is already registered. */
  register(reg: AgentRegistration): void {
    if (this.agents.has(reg.name)) {
      throw new Error(`Agent "${reg.name}" is already registered with the supervisor`);
    }
    this.agents.set(reg.name, {
      reg,
      restartHistory: [],
      pendingRestart: null,
    });
  }

  /** Remove an agent from supervision. Cancels any pending restart. */
  unregister(name: string): void {
    const state = this.agents.get(name);
    if (!state) return;
    if (state.pendingRestart !== null) clearTimeout(state.pendingRestart);
    this.agents.delete(name);
  }

  /** Start the heartbeat poll. Safe to call multiple times — subsequent calls are no-ops. */
  start(): void {
    if (this.timer !== null) return;
    writeFileSync(join(this.home, 'supervisor.pid'), String(process.pid) + '\n', 'utf8');
    this.timer = setInterval(() => void this.heartbeat(), this.opts.heartbeatIntervalMs);
    if (this.timer.unref) this.timer.unref();
  }

  /** Stop the heartbeat poll and cancel pending restarts. */
  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
    for (const state of this.agents.values()) {
      if (state.pendingRestart !== null) {
        clearTimeout(state.pendingRestart);
        state.pendingRestart = null;
      }
    }
  }

  get running(): boolean {
    return this.timer !== null;
  }

  /** Perform one full heartbeat check — exposed for testing. */
  async heartbeat(): Promise<void> {
    for (const [name, state] of this.agents) {
      if (state.pendingRestart !== null) continue;
      await this.checkAgent(name, state);
    }
  }

  private async checkAgent(name: string, state: AgentState): Promise<void> {
    const entry = this.table.get(name);
    if (!entry || entry.status !== 'running' || entry.pid === null) return;
    if (!isPidAlive(entry.pid)) {
      await this.handleDeath(name, state, entry.pid, null, null);
    }
  }

  private async handleDeath(
    name: string,
    state: AgentState,
    pid: number,
    exitCode: number | null,
    signal: string | null,
  ): Promise<void> {
    const policy = state.reg.restart ?? 'always';
    this.table.setDead(name);
    this.emit('agent:died', { name, pid, exitCode } satisfies AgentDiedEvent);

    // Prune restart history outside the reset window
    const now = Date.now();
    state.restartHistory = state.restartHistory.filter(
      (t) => now - t < this.opts.resetWindowMs,
    );
    const recentRestarts = state.restartHistory.length;

    // Check whether we should restart at all
    if (policy === 'never') return;
    if (policy === 'on-failure' && exitCode === 0) return;
    if (recentRestarts >= this.opts.maxRestarts) {
      this.table.setError(name);
      this.emit('agent:exhausted', { name, restartCount: recentRestarts } satisfies AgentExhaustedEvent);
      return;
    }

    const delay = computeBackoff(recentRestarts, {
      baseDelayMs: this.opts.baseDelayMs,
      maxBackoffMs: this.opts.maxBackoffMs,
    });
    const nextRestartAt = new Date(now + delay).toISOString();

    // Write crash record and set status to 'restarting'
    const agentDir = this.table.agentDir(name);
    writeCrashRecord(agentDir, { ts: new Date().toISOString(), exitCode, signal, restartCount: recentRestarts, nextRestartAt });
    writeFileSync(join(agentDir, 'status'), 'restarting\n', 'utf8');

    state.pendingRestart = setTimeout(async () => {
      state.pendingRestart = null;
      try {
        const newPid = await Promise.resolve(state.reg.spawn());
        this.table.setRunning(name, newPid);
        state.restartHistory.push(Date.now());
        this.emit('agent:restarted', { name, newPid, restartCount: state.restartHistory.length } satisfies AgentRestartedEvent);
      } catch (err) {
        this.table.setError(name);
        this.emit('error', { name, error: err });
      }
    }, delay);
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
