/**
 * @file cmd-inbox.ts
 * Implementation of `bract inbox` — lists pending and processed inbox messages.
 * @module @losoft/bract-cli/cmd-inbox
 */
import { ProcessTable, listPending, read } from '@losoft/bract-runtime';
import { join } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { relativeTime } from './format.js';
import { resolveBractHome } from './home.js';

export interface InboxOptions {
  home?: string;
  all?: boolean;
  json?: boolean;
}

export async function cmdInbox(agentName: string, opts: InboxOptions = {}): Promise<void> {
  const home = resolveBractHome(opts.home);
  const pt = new ProcessTable(home);
  const entry = pt.get(agentName);

  if (!entry) {
    process.stderr.write(`bract: agent "${agentName}" not found\n`);
    process.exit(3);
  }

  const inboxDir = join(entry.dir, 'inbox');
  const pending = listPending(inboxDir);

  const processed: string[] = [];
  if (opts.all) {
    const processedDir = join(inboxDir, '.processed');
    if (existsSync(processedDir)) {
      processed.push(
        ...readdirSync(processedDir)
          .filter((f: string) => f.endsWith('.msg'))
          .sort()
          .map((f) => join('.processed', f)),
      );
    }
  }

  if (opts.json) {
    const msgs = await Promise.all([
      ...pending.map(async (f) => ({ ...(await read(inboxDir, f)), _status: 'pending', _file: f })),
      ...processed.map(async (f) => ({ ...(await read(inboxDir, f)), _status: 'processed', _file: f })),
    ]);
    process.stdout.write(JSON.stringify(msgs, null, 2) + '\n');
    return;
  }

  const totalPending = pending.length;
  const totalProcessed = processed.length;
  const total = totalPending + (opts.all ? totalProcessed : 0);

  process.stdout.write(
    `INBOX — ${agentName} (${totalPending} pending${opts.all ? `, ${totalProcessed} processed` : ''})\n\n`,
  );

  if (total === 0) {
    process.stdout.write('  (empty)\n');
    return;
  }

  async function printMsg(file: string, dir: string, tag?: string): Promise<void> {
    try {
      const msg = await read(dir, file);
      const preview = msg.body.length > 80 ? msg.body.slice(0, 77) + '...' : msg.body;
      const label = tag ? `[${tag}] ` : '';
      process.stdout.write(
        `  ${file}\n  ${label}${relativeTime(msg.ts)}  from: ${msg.from}\n  "${preview}"\n\n`,
      );
    } catch {
      process.stdout.write(`  ${file}  (unreadable)\n\n`);
    }
  }

  for (const f of pending) await printMsg(f, inboxDir);
  for (const f of processed) await printMsg(f, inboxDir, 'processed');
}
