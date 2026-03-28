/**
 * Resolve the correct arguments for spawning a sentinel subprocess.
 *
 * In compiled Bun binaries: process.execPath IS the binary, so
 *   [execPath, '__worker']  →  bract __worker  ✓
 *
 * In source mode (bun run): process.execPath is the bun runtime and
 * process.argv[1] is the entry script (index.ts), so
 *   [execPath, script, '__worker']  →  bun index.ts __worker  ✓
 *
 * @param sentinel - The sentinel string, e.g. '__worker' or '__supervisor'
 * @returns Tuple of [execPath, ...args] to pass to Bun.spawn
 */
export function sentinelCommand(sentinel: string): [string, ...string[]] {
  const script = process.argv[1];
  // Source mode: argv[1] is the .ts or .js entry script
  if (script && (script.endsWith('.ts') || script.endsWith('.js'))) {
    return [process.execPath, script, sentinel];
  }
  // Compiled binary mode: execPath is the binary itself
  return [process.execPath, sentinel];
}
