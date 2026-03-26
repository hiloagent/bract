import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeCrashRecord } from './crash-record.js';

function tmpDir() {
  return mkdtempSync(join(tmpdir(), 'bract-crash-test-'));
}

describe('writeCrashRecord', () => {
  it('creates the crashes/ directory and writes a JSON file', () => {
    const agentDir = tmpDir();
    const record = {
      ts: '2026-03-25T00:00:00.000Z',
      exitCode: 1,
      signal: null,
      restartCount: 0,
      nextRestartAt: '2026-03-25T00:00:01.000Z',
    };

    const filename = writeCrashRecord(agentDir, record);

    expect(filename).toMatch(/\.json$/);
    const files = readdirSync(join(agentDir, 'crashes'));
    expect(files).toContain(filename);

    const parsed = JSON.parse(readFileSync(join(agentDir, 'crashes', filename), 'utf8'));
    expect(parsed).toMatchObject(record);
  });

  it('each call produces a unique filename', () => {
    const agentDir = tmpDir();
    const rec = { ts: new Date().toISOString(), exitCode: null, signal: null, restartCount: 0, nextRestartAt: null };
    const f1 = writeCrashRecord(agentDir, rec);
    const f2 = writeCrashRecord(agentDir, rec);
    expect(f1).not.toBe(f2);
  });

  it('is idempotent — does not throw if crashes/ already exists', () => {
    const agentDir = tmpDir();
    const rec = { ts: new Date().toISOString(), exitCode: 0, signal: null, restartCount: 1, nextRestartAt: null };
    expect(() => {
      writeCrashRecord(agentDir, rec);
      writeCrashRecord(agentDir, rec);
    }).not.toThrow();
  });
});
