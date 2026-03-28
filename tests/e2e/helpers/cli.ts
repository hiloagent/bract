/**
 * @file helpers/cli.ts
 * Runs the bract CLI as a subprocess and captures stdout, stderr, exit code.
 */
import { join } from 'node:path';
import { existsSync } from 'node:fs';

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Resolve the bract binary to test.
 *
 * - BRACT_E2E_BINARY=1 → compiled binary at packages/cli/dist/bract
 * - default           → source via `bun run packages/cli/src/index.ts`
 */
function resolveBinary(): { cmd: string; args: string[] } {
  const repoRoot = join(import.meta.dir, '..', '..', '..');
  if (process.env.BRACT_E2E_BINARY === '1') {
    const bin = join(repoRoot, 'packages', 'cli', 'dist', 'bract');
    if (!existsSync(bin)) {
      throw new Error(`Compiled binary not found at ${bin} — run 'bun run build' first`);
    }
    return { cmd: bin, args: [] };
  }
  return {
    cmd: process.execPath,
    args: ['run', join(repoRoot, 'packages', 'cli', 'src', 'index.ts')],
  };
}

const { cmd, args: baseArgs } = resolveBinary();

/**
 * Run the bract CLI with given arguments and optional env overrides.
 * Resolves when the process exits.
 */
export async function cli(
  args: string[],
  opts: { env?: Record<string, string>; stdin?: string; cwd?: string } = {},
): Promise<CliResult> {
  const proc = Bun.spawn([cmd, ...baseArgs, ...args], {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env } as Record<string, string>,
    stdin: opts.stdin ? Buffer.from(opts.stdin) : 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}
