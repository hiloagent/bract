/**
 * @file spawn-cmd.ts
 * Helper to resolve the CLI invocation command for spawning workers/supervisor.
 *
 * In compiled Bun binary mode, process.execPath IS the binary — sentinels like
 * __worker are passed as plain args and handled in index.ts.
 *
 * In source mode (bun run index.ts), process.execPath is the bun interpreter
 * and the script path must be passed explicitly so the right entry point runs.
 *
 * @module @losoft/bract-cli/spawn-cmd
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Build the argv array for spawning the CLI with the given sentinel/args.
 * Compiled: [process.execPath, ...args]
 * Source:   [process.execPath, /path/to/index.ts, ...args]
 */
export function spawnCmd(...args: string[]): string[] {
  const indexPath = join(import.meta.dir, 'index.ts');
  if (existsSync(indexPath)) {
    // Source mode — pass the script path so bun runs the right entry point
    return [process.execPath, indexPath, ...args];
  }
  // Compiled mode — the binary handles sentinels directly
  return [process.execPath, ...args];
}
