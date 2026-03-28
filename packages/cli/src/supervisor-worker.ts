/**
 * @file supervisor-worker.ts
 * Subprocess entry point for the bract supervisor.
 *
 * Reads configuration from environment variables, registers all agents
 * with the Supervisor, and blocks until terminated.
 *
 * Environment variables:
 *   BRACT_HOME        - Path to bract home directory (required)
 *   BRACT_CONFIG      - Path to bract.yml (required)
 *
 * @module @losoft/bract-cli/supervisor-worker
 */
import { join } from 'node:path';
import { unlinkSync, existsSync } from 'node:fs';
import { Supervisor } from '@losoft/bract-supervisor';
import { ProcessTable, PipeRouter } from '@losoft/bract-runtime';
import type { PipeDef } from '@losoft/bract-runtime';
import { parseBractConfig } from './cmd-spawn.js';
import { spawnCmd } from './spawn-cmd.js';

/**
 * Entry point called when the binary is invoked with __supervisor sentinel.
 */
export async function runSupervisor(): Promise<void> {
  const home = process.env.BRACT_HOME;
  const configPath = process.env.BRACT_CONFIG;

  if (!home || !configPath) {
    process.stderr.write('supervisor-worker: BRACT_HOME and BRACT_CONFIG are required\n');
    process.exit(1);
  }

  let config;
  try {
    config = await parseBractConfig(configPath);
  } catch (e) {
    process.stderr.write(`supervisor-worker: ${(e as Error).message}\n`);
    process.exit(1);
  }

  // Use __worker sentinel so compiled SFE can spawn itself as an agent worker.
  const pt = new ProcessTable(home);
  const supervisor = new Supervisor(home);

  function spawnAgent(agent: { name: string; model: string; system?: string }): number {
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      BRACT_HOME: home!,
      BRACT_AGENT_NAME: agent.name,
      BRACT_AGENT_MODEL: agent.model,
    };
    if (agent.system) env.BRACT_AGENT_SYSTEM = agent.system;
    if (process.env.BRACT_AGENT_BASE_URL) env.BRACT_AGENT_BASE_URL = process.env.BRACT_AGENT_BASE_URL;

    pt.register(agent.name, agent.model);

    const proc = Bun.spawn(spawnCmd('__worker'), {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    pt.setRunning(agent.name, proc.pid);
    process.stderr.write(`[supervisor] started ${agent.name} (pid ${proc.pid})\n`);
    return proc.pid;
  }

  for (const agent of config.agents) {
    supervisor.register({
      name: agent.name,
      restart: agent.restart ?? 'on-failure',
      spawn: () => spawnAgent(agent),
    });
    spawnAgent(agent);
  }

  supervisor.on('agent:died', ({ name, pid }) => {
    process.stderr.write(`[supervisor] ${name} (pid ${pid}) died\n`);
  });

  supervisor.on('agent:restarted', ({ name, newPid, restartCount }) => {
    process.stderr.write(`[supervisor] restarted ${name} (pid ${newPid}, restart #${restartCount})\n`);
  });

  supervisor.on('agent:exhausted', ({ name, restartCount }) => {
    process.stderr.write(`[supervisor] ${name} exhausted restart limit (${restartCount} restarts)\n`);
  });

  // Build pipe definitions from config
  const pipeDefs: PipeDef[] = [];
  for (const agent of config.agents) {
    for (const pipe of agent.pipes ?? []) {
      pipeDefs.push({ from: pipe.from, to: agent.name, filter: pipe.filter });
    }
  }

  // Start PipeRouter if any pipes are defined
  let pipeRouter: PipeRouter | null = null;
  if (pipeDefs.length > 0) {
    pipeRouter = new PipeRouter(pt.root, pipeDefs);
    pipeRouter.start();
    process.stderr.write(`[supervisor] pipe router started (${pipeDefs.length} pipe(s))\n`);
  }

  // Reffed keepalive prevents the event loop from exiting when agent pipes close.
  // Without this, the supervisor exits when the last agent process dies, preventing restarts.
  const keepAlive = setInterval(() => {}, 2_147_483_647);

  async function shutdown() {
    clearInterval(keepAlive);
    supervisor.stop();
    pipeRouter?.stop();
    const pidFile = join(home!, 'supervisor.pid');
    if (existsSync(pidFile)) try { unlinkSync(pidFile); } catch { /* ignore */ }
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  supervisor.start();

  // Block until signal
  await new Promise<void>(() => {});
}
