/**
 * CLI test helper — spawns the bract CLI and captures output.
 *
 * In source mode (default), runs `bun packages/cli/src/index.ts`.
 * Set BRACT_E2E_BINARY=1 to test against the compiled binary instead.
 */
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '../../..');

/** Result of a CLI invocation. */
export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CliOptions {
  env?: Record<string, string>;
  stdin?: string;
  cwd?: string;
  /** Timeout in ms. Default: 10_000 */
  timeout?: number;
}

function binaryPath(): string {
  if (process.env.BRACT_E2E_BINARY) {
    // Expect the compiled binary to be at packages/cli/dist/bract
    return join(REPO_ROOT, 'packages/cli/dist/bract');
  }
  return join(REPO_ROOT, 'packages/cli/src/index.ts');
}

function buildArgs(cliArgs: string[]): [string, string[]] {
  if (process.env.BRACT_E2E_BINARY) {
    return [binaryPath(), cliArgs];
  }
  return [process.execPath, [binaryPath(), ...cliArgs]];
}

/**
 * Spawn `bract <args>` and return stdout, stderr, and exit code.
 * Never throws — exits codes are captured in the result.
 */
export async function cli(
  args: string[],
  opts: CliOptions = {},
): Promise<CliResult> {
  const [cmd, fullArgs] = buildArgs(args);
  const timeout = opts.timeout ?? 10_000;

  const proc = Bun.spawn([cmd, ...fullArgs], {
    cwd: opts.cwd ?? REPO_ROOT,
    env: {
      ...(process.env as Record<string, string>),
      ...opts.env,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Feed stdin if provided
  if (opts.stdin) {
    proc.stdin.write(opts.stdin);
    proc.stdin.end();
  } else {
    proc.stdin.end();
  }

  const timeoutId = setTimeout(() => {
    try { proc.kill(); } catch { /* ignore */ }
  }, timeout);

  const [stdoutBuf, stderrBuf, exitCode] = await Promise.all([
    Bun.readableStreamToText(proc.stdout),
    Bun.readableStreamToText(proc.stderr),
    proc.exited,
  ]);

  clearTimeout(timeoutId);

  return {
    stdout: stdoutBuf,
    stderr: stderrBuf,
    exitCode: exitCode ?? 1,
  };
}
