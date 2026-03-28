/**
 * @file cmd-up.ts
 * Implementation of `bract up` — start the agent fleet via the supervisor.
 * @module @losoft/bract-cli/cmd-up
 */
import { resolve, join } from 'node:path';
import { existsSync, readFileSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { resolveBractHome } from './home.js';
import { parseBractConfig } from './cmd-spawn.js';
import { sentinelCommand } from './spawn-args.js';

export interface UpOptions {
  /** Path to bract.yml. Default: ./bract.yml */
  file?: string;
  /** Override BRACT_HOME. */
  home?: string;
  /** Run supervisor in the foreground instead of detaching. */
  follow?: boolean;
  /** Machine-readable JSON output. */
  json?: boolean;
}

/** Check if the supervisor is already running by reading supervisor.pid. */
function supervisorPid(home: string): number | null {
  const pidFile = join(home, 'supervisor.pid');
  if (!existsSync(pidFile)) return null;
  const raw = readFileSync(pidFile, 'utf8').trim();
  const pid = parseInt(raw, 10);
  if (isNaN(pid)) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

/** Start the supervisor for a bract.yml fleet. */
export async function cmdUp(opts: UpOptions = {}): Promise<void> {
  const filePath = resolve(opts.file ?? 'bract.yml');
  const home = resolveBractHome(opts.home);

  // Validate config first
  let config;
  try {
    config = await parseBractConfig(filePath);
  } catch (e) {
    process.stderr.write(`bract up: ${(e as Error).message}\n`);
    process.exit(1);
    return;
  }

  // Check if already running
  const existing = supervisorPid(home);
  if (existing !== null) {
    if (opts.json) {
      process.stdout.write(JSON.stringify({ running: true, pid: existing }) + '\n');
    } else {
      process.stdout.write(`supervisor already running (pid ${existing})\n`);
    }
    return;
  }

  if (opts.follow) {
    const { Supervisor } = await import('@losoft/bract-supervisor');
    const { ProcessTable } = await import('@losoft/bract-runtime');
    const pt = new ProcessTable(home);
    const supervisor = new Supervisor(home);

    for (const agent of config.agents) {
      const agentCopy = agent;
      const spawnFn = () => {
        const env: Record<string, string> = { ...(process.env as Record<string, string>), BRACT_HOME: home, BRACT_AGENT_NAME: agentCopy.name, BRACT_AGENT_MODEL: agentCopy.model };
        if (agentCopy.system) env.BRACT_AGENT_SYSTEM = agentCopy.system;
        pt.register(agentCopy.name, agentCopy.model);
        const logDir = join(home, 'agents', agentCopy.name, 'logs');
        mkdirSync(logDir, { recursive: true });
        const logFd = openSync(join(logDir, 'agent.log'), 'a');
        const proc = Bun.spawn(sentinelCommand('__worker'), { env, stdio: ['ignore', logFd, logFd] });
        closeSync(logFd);
        pt.setRunning(agentCopy.name, proc.pid);
        return proc.pid;
      };
      supervisor.register({ name: agentCopy.name, restart: agentCopy.restart ?? 'on-failure', spawn: spawnFn });
      spawnFn();
    }

    process.on('SIGINT', () => { supervisor.stop(); process.exit(0); });
    process.on('SIGTERM', () => { supervisor.stop(); process.exit(0); });
    supervisor.on('agent:died', (e: { name: string; pid: number }) => process.stdout.write('  died ' + e.name + ' (pid ' + e.pid + ')\n'));
    supervisor.on('agent:restarted', (e: { name: string; newPid: number }) => process.stdout.write('  restarted ' + e.name + ' (pid ' + e.newPid + ')\n'));
    supervisor.on('agent:exhausted', (e: { name: string }) => process.stdout.write('  ' + e.name + ' exhausted restart limit\n'));

    process.stdout.write('starting ' + config.agents.length + ' agent(s)...\n');
    supervisor.start();
    setInterval(() => {}, 2_147_483_647); // keepalive — holds event loop after agent exits
    await new Promise<void>(() => {});
    return;
  }

  // Detached mode
  const proc = Bun.spawn(
    sentinelCommand('__supervisor'),
    {
      env: {
        ...(process.env as Record<string, string>),
        BRACT_HOME: home,
        BRACT_CONFIG: filePath,
      },
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore'],
    },
  );

  proc.unref();

  // Wait briefly for supervisor.pid to appear
  let tries = 0;
  while (tries < 20 && !existsSync(join(home, 'supervisor.pid'))) {
    await Bun.sleep(100);
    tries++;
  }

  const pid = supervisorPid(home);

  if (opts.json) {
    process.stdout.write(JSON.stringify({
      started: pid !== null,
      pid,
      agents: config.agents.map((a) => a.name),
    }) + '\n');
  } else {
    if (pid !== null) {
      process.stdout.write(
        `supervisor started (pid ${pid})\n` +
        config.agents.map((a) => `  + ${a.name}`).join('\n') + '\n',
      );
    } else {
      process.stderr.write('bract up: supervisor started but pid not yet written — check logs\n');
    }
  }
}
