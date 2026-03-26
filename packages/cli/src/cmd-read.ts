import { ProcessTable, listPending, read } from '@losoft/bract-runtime';
import { join } from 'node:path';
import { relativeTime } from './format.js';
import { resolveBractHome } from './home.js';

export interface ReadOptions {
  home?: string;
  all?: boolean;
  json?: boolean;
}

export async function cmdRead(agentName: string, opts: ReadOptions = {}): Promise<void> {
  const home = resolveBractHome(opts.home);
  const pt = new ProcessTable(home);
  const entry = pt.get(agentName);

  if (!entry) {
    process.stderr.write(`bract: agent "${agentName}" not found\n`);
    process.exit(3);
  }

  const outboxDir = join(entry.dir, 'outbox');
  const files = listPending(outboxDir);

  if (opts.json) {
    const msgs = await Promise.all(files.map(async (f) => ({ ...(await read(outboxDir, f)), _file: f })));
    process.stdout.write(JSON.stringify(opts.all ? msgs : msgs.slice(-1), null, 2) + '\n');
    return;
  }

  if (files.length === 0) {
    process.stdout.write(`OUTBOX — ${agentName}\n\n  (empty)\n`);
    return;
  }

  const toShow = opts.all ? files : files.slice(-1);
  process.stdout.write(`OUTBOX — ${agentName} (showing ${toShow.length} of ${files.length})\n\n`);

  for (const f of toShow) {
    try {
      const msg = await read(outboxDir, f);
      process.stdout.write(`  ${f}\n  ${relativeTime(msg.ts)}  from: ${msg.from}\n\n${msg.body}\n\n`);
    } catch {
      process.stdout.write(`  ${f}  (unreadable)\n\n`);
    }
  }
}
