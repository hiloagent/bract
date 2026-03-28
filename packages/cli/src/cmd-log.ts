/**
 * @file cmd-log.ts
 * Implementation of `bract log` — stream or display agent log output.
 * @module @losoft/bract-cli/cmd-log
 */
import { join, resolve } from 'node:path';
import { existsSync, statSync, readFileSync, watchFile, unwatchFile, openSync, readSync, closeSync } from 'node:fs';
import { resolveBractHome } from './home.js';

export interface LogOptions {
  /** Agent name. */
  name: string;
  /** Stream new log entries as they arrive (like tail -f). */
  follow?: boolean;
  /** Show all log entries from the beginning. Default: last 20 lines. */
  all?: boolean;
  /** Override BRACT_HOME. */
  home?: string;
}

/** Return the last N lines of a string. */
function tail(content: string, n: number): string {
  const lines = content.split('\n');
  // Remove trailing empty line from final newline
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.slice(-n).join('\n') + (lines.length > 0 ? '\n' : '');
}

/** Display agent log output. */
export async function cmdLog(opts: LogOptions): Promise<void> {
  const home = resolveBractHome(opts.home);
  const logFile = join(home, 'agents', opts.name, 'logs', 'agent.log');

  if (!existsSync(logFile)) {
    const agentDir = join(home, 'agents', opts.name);
    if (!existsSync(agentDir)) {
      process.stderr.write(`bract log: unknown agent "${opts.name}"\n`);
      process.exit(3);
      return;
    }
    // Agent exists but no log yet
    if (!opts.follow) {
      process.stdout.write(`(no log entries yet for ${opts.name})\n`);
      return;
    }
    process.stdout.write(`(waiting for ${opts.name} to produce logs...)\n`);
  } else {
    const content = readFileSync(logFile, 'utf8');
    process.stdout.write(opts.all ? content : tail(content, 20));
  }

  if (!opts.follow) return;

  // Follow mode: watch for new content
  let lastSize = existsSync(logFile) ? statSync(logFile).size : 0;

  process.stdout.write('[following — press Ctrl+C to stop]\n');

  watchFile(logFile, { interval: 250 }, (curr) => {
    if (curr.size > lastSize) {
      // Read new bytes
      const fd = openSync(logFile, 'r');
      const buf = Buffer.alloc(curr.size - lastSize);
      readSync(fd, buf, 0, buf.length, lastSize);
      closeSync(fd);
      process.stdout.write(buf.toString('utf8'));
      lastSize = curr.size;
    }
  });

  // Block until Ctrl+C
  process.on('SIGINT', () => {
    unwatchFile(logFile);
    process.exit(0);
  });

  await new Promise<void>(() => {});
}
