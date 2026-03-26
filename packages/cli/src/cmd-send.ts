import { ProcessTable, send } from '@losoft/bract-runtime';
import { join } from 'node:path';
import { resolveBractHome } from './home.js';

export interface SendOptions {
  home?: string;
  from?: string;
}

export function cmdSend(agentName: string, body: string, opts: SendOptions = {}): void {
  const home = resolveBractHome(opts.home);
  const pt = new ProcessTable(home);
  const entry = pt.get(agentName);

  if (!entry) {
    process.stderr.write(`bract: agent "${agentName}" not found\n`);
    process.exit(3);
  }

  const from = opts.from ?? 'cli';
  const inboxDir = join(entry.dir, 'inbox');
  const msg = send(inboxDir, from, body);

  process.stdout.write(`sent  ${msg.id}  →  ${agentName}\n`);
}
