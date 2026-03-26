import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export type AgentStatus = 'running' | 'idle' | 'dead' | 'error' | 'restarting';

export interface AgentEntry {
  name: string;
  pid: number | null;
  status: AgentStatus;
  model: string;
  startedAt: string | null;
  dir: string;
}

/** Read a file relative to the agent directory, returning null if missing. */
function readField(agentDir: string, field: string): string | null {
  const p = join(agentDir, field);
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf8').trim() || null;
}

function writeField(agentDir: string, field: string, value: string): void {
  writeFileSync(join(agentDir, field), value + '\n', 'utf8');
}

export class ProcessTable {
  readonly root: string;

  constructor(home: string) {
    this.root = join(home, 'agents');
    mkdirSync(this.root, { recursive: true });
  }

  /** Return the directory for a named agent. */
  agentDir(name: string): string {
    return join(this.root, name);
  }

  /** List all agent names registered in the process table. */
  list(): string[] {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  }

  /** Read the current entry for a named agent. Returns null if not registered. */
  get(name: string): AgentEntry | null {
    const dir = this.agentDir(name);
    if (!existsSync(dir)) return null;

    const pidStr = readField(dir, 'pid');
    const pid = pidStr ? parseInt(pidStr, 10) : null;
    const status = (readField(dir, 'status') ?? 'dead') as AgentStatus;
    const model = readField(dir, 'model') ?? 'unknown';
    const startedAt = readField(dir, 'started_at');

    return { name, pid, status, model, startedAt, dir };
  }

  /** Register a new agent, creating its directory structure. */
  register(name: string, model: string): AgentEntry {
    const dir = this.agentDir(name);
    mkdirSync(join(dir, 'inbox'), { recursive: true });
    mkdirSync(join(dir, 'outbox'), { recursive: true });
    mkdirSync(join(dir, 'memory'), { recursive: true });
    mkdirSync(join(dir, 'logs'), { recursive: true });

    writeField(dir, 'model', model);
    writeField(dir, 'status', 'idle');
    writeField(dir, 'pid', '');

    return this.get(name)!;
  }

  /** Mark an agent as running with a given PID. */
  setRunning(name: string, pid: number): void {
    const dir = this.agentDir(name);
    writeField(dir, 'pid', String(pid));
    writeField(dir, 'status', 'running');
    writeField(dir, 'started_at', new Date().toISOString());
  }

  /** Mark an agent as idle (finished processing, waiting for next message). */
  setIdle(name: string): void {
    const dir = this.agentDir(name);
    writeField(dir, 'status', 'idle');
  }

  /** Mark an agent as dead. */
  setDead(name: string): void {
    const dir = this.agentDir(name);
    writeField(dir, 'status', 'dead');
    writeField(dir, 'pid', '');
  }

  /** Mark an agent as errored. */
  setError(name: string): void {
    const dir = this.agentDir(name);
    writeField(dir, 'status', 'error');
    writeField(dir, 'pid', '');
  }

  /** Snapshot all agents — equivalent of `ps`. */
  snapshot(): AgentEntry[] {
    return this.list()
      .map((name) => this.get(name))
      .filter((e): e is AgentEntry => e !== null);
  }
}
