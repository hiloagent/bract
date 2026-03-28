/**
 * @file cmd-spawn.ts
 * Implementation of `bract spawn` — spawns an agent from bract.yml.
 * @module @losoft/bract-cli/cmd-spawn
 */
import { resolve, join } from 'node:path';
import { mkdirSync, openSync } from 'node:fs';
import { ProcessTable } from '@losoft/bract-runtime';
import { resolveBractHome } from './home.js';
import { spawnCmd } from './spawn-cmd.js';

export interface BractAgentConfig {
  name: string;
  model: string;
  system?: string;
  restart?: "always" | "on-failure" | "never";
  pipes?: Array<{ from: string; filter?: string }>;
}

export interface BractConfig {
  version: number;
  home?: string;
  agents: BractAgentConfig[];
}

export interface SpawnOptions {
  /** Agent name to spawn. Either name or all must be provided. */
  name?: string;
  /** Spawn all agents defined in bract.yml. */
  all?: boolean;
  /** Daemonise the agent process. */
  detach?: boolean;
  /** Stream agent logs after spawning. */
  follow?: boolean;
  /** Path to bract.yml (default: ./bract.yml). */
  file?: string;
  /** Override BRACT_HOME. */
  home?: string;
  /** Machine-readable JSON output. */
  json?: boolean;
}

// ---- Config parsing ----

/**
 * Parse and lightly validate a bract.yml file.
 * Throws with a descriptive message on any error.
 */
export async function parseBractConfig(filePath: string): Promise<BractConfig> {
  let raw: string;
  try {
    raw = await Bun.file(filePath).text();
  } catch {
    throw new Error(`cannot read file: ${filePath}`);
  }

  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(raw);
  } catch (e) {
    throw new Error(`YAML parse error: ${(e as Error).message}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('bract.yml must be a YAML object');
  }

  const c = parsed as Record<string, unknown>;

  if (c.version !== 1) {
    throw new Error(`bract.yml: version must be 1 (got ${JSON.stringify(c.version)})`);
  }

  if (!Array.isArray(c.agents) || c.agents.length === 0) {
    throw new Error('bract.yml: agents must be a non-empty array');
  }

  const agents: BractAgentConfig[] = (c.agents as unknown[]).map((a, i) => {
    if (typeof a !== 'object' || a === null || Array.isArray(a)) {
      throw new Error(`bract.yml: agents[${i}] must be an object`);
    }
    const agent = a as Record<string, unknown>;
    if (typeof agent.name !== 'string' || agent.name.length === 0) {
      throw new Error(`bract.yml: agents[${i}].name is required`);
    }
    if (typeof agent.model !== 'string' || agent.model.length === 0) {
      throw new Error(`bract.yml: agents[${i}].model is required`);
    }
    return {
      name: agent.name,
      model: agent.model,
      system: typeof agent.system === 'string' ? agent.system : undefined,
    };
  });

  return {
    version: 1,
    home: typeof c.home === 'string' ? c.home : undefined,
    agents,
  };
}

// ---- Agent selection ----

/**
 * Select which agents to spawn from the config.
 * @param config - Parsed bract config.
 * @param name   - Agent name to spawn (mutually exclusive with all).
 * @param all    - Spawn all agents.
 */
export function selectAgents(
  config: BractConfig,
  name?: string,
  all?: boolean,
): BractAgentConfig[] {
  if (name !== undefined) {
    const agent = config.agents.find((a) => a.name === name);
    if (!agent) {
      throw new Error(`unknown agent: ${name} — not found in bract.yml`);
    }
    return [agent];
  }

  if (all) {
    return [...config.agents];
  }

  throw new Error('provide an agent name or --all to spawn all agents');
}

// ---- Spawn ----

/** Spawn a single agent as a detached background process. */
async function spawnDetached(
  agent: BractAgentConfig,
  home: string,
): Promise<number> {
  const pt = new ProcessTable(home);
  pt.register(agent.name, agent.model);

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    BRACT_HOME: home,
    BRACT_AGENT_NAME: agent.name,
    BRACT_AGENT_MODEL: agent.model,
  };
  if (agent.system) env.BRACT_AGENT_SYSTEM = agent.system;

  const logDir = join(home, 'agents', agent.name, 'logs');
  mkdirSync(logDir, { recursive: true });
  // Use a real file fd rather than a pipe so the worker's stderr/stdout
  // stay open after the CLI exits. A pipe would send SIGPIPE to the worker
  // on its next write, killing it before any signal handler can run.
  const logFd = openSync(join(logDir, 'agent.log'), 'a');

  const proc = Bun.spawn(
    spawnCmd('__worker'),
    {
      env,
      detached: true,
      stdio: ['ignore', logFd, logFd],
    },
  );

  const pid = proc.pid;
  pt.setRunning(agent.name, pid);
  proc.unref();

  return pid;
}

/** Run a single agent in the foreground (blocking). */
async function spawnForeground(
  agent: BractAgentConfig,
  home: string,
  follow: boolean,
): Promise<void> {
  const { AgentRunner } = await import('@losoft/bract-runner');
  const pt = new ProcessTable(home);
  pt.register(agent.name, agent.model);
  pt.setRunning(agent.name, process.pid);

  const runner = new AgentRunner({
    name: agent.name,
    home,
    model: agent.model,
    system: agent.system,
  });

  // Reffed keepalive holds the event loop open in compiled Bun SFEs where
  // InboxWatcher's unref'd timer would otherwise let the process exit.
  const keepAlive = setInterval(() => {}, 2_147_483_647);

  // Cleanup function for graceful shutdown on signals.
  const cleanupAndExit = () => {
    clearInterval(keepAlive);
    runner.stop();
    pt.setDead(agent.name);
    process.exit(0);
  };

  process.once('SIGINT', cleanupAndExit);
  process.once('SIGTERM', cleanupAndExit);

  if (!follow) {
    process.stdout.write(`spawned ${agent.name} (pid ${process.pid})\n`);
  }

  await runner.start();

  // Block until signal; keepAlive timer above holds the event loop open.
  await new Promise<void>(() => { /* run until signal */ });
}

// ---- Entry point ----

/** Spawn one or more agents from bract.yml. */
export async function cmdSpawn(opts: SpawnOptions = {}): Promise<void> {
  const filePath = resolve(opts.file ?? 'bract.yml');
  const home = resolveBractHome(opts.home);

  let config: BractConfig;
  try {
    config = await parseBractConfig(filePath);
  } catch (e) {
    process.stderr.write(`bract spawn: ${(e as Error).message}\n`);
    process.exit(1);
    return;
  }

  let agents: BractAgentConfig[];
  try {
    agents = selectAgents(config, opts.name, opts.all);
  } catch (e) {
    process.stderr.write(`bract spawn: ${(e as Error).message}\n`);
    process.exit(1);
    return;
  }

  if (opts.detach) {
    for (const agent of agents) {
      let pid: number;
      try {
        pid = await spawnDetached(agent, home);
      } catch (e) {
        process.stderr.write(`bract spawn: failed to spawn ${agent.name}: ${(e as Error).message}\n`);
        process.exit(1);
        return;
      }

      if (opts.json) {
        process.stdout.write(JSON.stringify({ name: agent.name, pid, status: 'running' }) + '\n');
      } else {
        process.stdout.write(`spawned ${agent.name} (pid ${pid}) [detached]\n`);
      }
    }
    return;
  }

  // Foreground mode — only one agent at a time
  if (agents.length > 1) {
    process.stderr.write('bract spawn: use --detach to spawn multiple agents simultaneously\n');
    process.exit(1);
    return;
  }

  const agent = agents[0];
  if (!agent) {
    process.stderr.write('bract spawn: no agents selected\n');
    process.exit(1);
    return;
  }
  await spawnForeground(agent, home, opts.follow ?? false);
}
