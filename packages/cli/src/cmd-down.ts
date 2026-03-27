/**
 * @file cmd-down.ts
 * Implementation of `bract down` — stop the supervisor and all agents.
 * @module @losoft/bract-cli/cmd-down
 */
import { join } from 'node:path';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { resolveBractHome } from './home.js';

export interface DownOptions {
  /** Override BRACT_HOME. */
  home?: string;
  /** Machine-readable JSON output. */
  json?: boolean;
}

/** Stop the supervisor (and all agents it manages). */
export async function cmdDown(opts: DownOptions = {}): Promise<void> {
  const home = resolveBractHome(opts.home);
  const pidFile = join(home, 'supervisor.pid');

  if (!existsSync(pidFile)) {
    if (opts.json) {
      process.stdout.write(JSON.stringify({ running: false }) + '\n');
    } else {
      process.stdout.write('no supervisor running\n');
    }
    return;
  }

  const raw = readFileSync(pidFile, 'utf8').trim();
  const pid = parseInt(raw, 10);

  if (isNaN(pid)) {
    process.stderr.write('bract down: supervisor.pid contains invalid data\n');
    process.exit(1);
    return;
  }

  // Check if alive
  try {
    process.kill(pid, 0);
  } catch {
    // Not running — stale pid file
    if (opts.json) {
      process.stdout.write(JSON.stringify({ running: false, stale: true }) + '\n');
    } else {
      process.stdout.write('supervisor not running (stale pid file removed)\n');
    }
    try { unlinkSync(pidFile); } catch { /* ignore */ }
    return;
  }

  // Send SIGTERM
  try {
    process.kill(pid, 'SIGTERM');
  } catch (e) {
    process.stderr.write(`bract down: failed to signal supervisor: ${(e as Error).message}\n`);
    process.exit(1);
    return;
  }

  // Wait for pid file to disappear (supervisor cleans it up on exit)
  let waited = 0;
  while (waited < 10_000 && existsSync(pidFile)) {
    await Bun.sleep(200);
    waited += 200;
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify({ stopped: true, pid }) + '\n');
  } else {
    process.stdout.write(`supervisor stopped (pid ${pid})\n`);
  }
}
