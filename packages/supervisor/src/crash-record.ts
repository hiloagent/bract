import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export interface CrashRecord {
  ts: string;
  exitCode: number | null;
  signal: string | null;
  restartCount: number;
  nextRestartAt: string | null;
}

/**
 * Write a crash record JSON file into `agentDir/crashes/`.
 * Filename: `{timestamp_ns}-{random_hex}.json`
 *
 * Returns the filename that was written.
 */
export function writeCrashRecord(agentDir: string, record: CrashRecord): string {
  const crashDir = join(agentDir, 'crashes');
  mkdirSync(crashDir, { recursive: true });

  const ns = BigInt(Date.now()) * 1_000_000n;
  const id = randomBytes(4).toString('hex');
  const filename = `${ns}-${id}.json`;

  writeFileSync(join(crashDir, filename), JSON.stringify(record, null, 2) + '\n', 'utf8');
  return filename;
}
