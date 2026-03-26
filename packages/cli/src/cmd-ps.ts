/**
 * @file cmd-ps.ts
 * Implementation of `bract ps` — lists all registered agents with status.
 * @module @losoft/bract-cli/cmd-ps
 */
import { ProcessTable } from '@losoft/bract-runtime';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { table, relativeTime } from './format.js';
import { resolveBractHome } from './home.js';

export interface PsOptions {
  home?: string;
  json?: boolean;
}

function crashCount(agentDir: string): string {
  const crashDir = join(agentDir, 'crashes');
  if (!existsSync(crashDir)) return '0';
  try {
    return String(readdirSync(crashDir).filter((f) => f.endsWith('.json')).length);
  } catch {
    return '?';
  }
}

export function cmdPs(opts: PsOptions = {}): void {
  const home = resolveBractHome(opts.home);
  const pt = new ProcessTable(home);
  const agents = pt.snapshot();

  if (opts.json) {
    process.stdout.write(JSON.stringify(agents, null, 2) + '\n');
    return;
  }

  if (agents.length === 0) {
    process.stdout.write('No agents registered.\n');
    return;
  }

  const rows = agents.map((a) => [
    a.name,
    a.status,
    a.model,
    a.pid !== null ? String(a.pid) : '—',
    crashCount(a.dir),
    relativeTime(a.startedAt),
  ]);

  process.stdout.write(
    table(rows, ['NAME', 'STATUS', 'MODEL', 'PID', 'CRASHES', 'STARTED']) + '\n',
  );
}
