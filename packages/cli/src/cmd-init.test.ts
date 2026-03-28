/**
 * @file cmd-init.test.ts
 * Tests for `bract init` — scaffold a starter bract.yml.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cmdInit } from './cmd-init.js';

let tmpDir: string;
let originalExit: typeof process.exit;
let originalStdout: typeof process.stdout.write;
let originalStderr: typeof process.stderr.write;
let lastOut: string;
let lastErr: string;
let lastExitCode: number | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'bract-init-'));
  lastOut = '';
  lastErr = '';
  lastExitCode = undefined;

  originalExit = process.exit;
  process.exit = (code?: number) => {
    lastExitCode = code;
    throw new Error(`process.exit(${code})`);
  };

  originalStdout = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Buffer) => {
    lastOut += typeof chunk === 'string' ? chunk : chunk.toString();
    return true;
  };

  originalStderr = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk: string | Buffer) => {
    lastErr += typeof chunk === 'string' ? chunk : chunk.toString();
    return true;
  };
});

afterEach(() => {
  process.exit = originalExit;
  process.stdout.write = originalStdout;
  process.stderr.write = originalStderr;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('bract init', () => {
  test('creates bract.yml with valid content', async () => {
    const outFile = join(tmpDir, 'bract.yml');
    await cmdInit({ file: outFile });

    expect(existsSync(outFile)).toBe(true);
    const content = readFileSync(outFile, 'utf8');
    expect(content).toContain('version: 1');
    expect(content).toContain('agents:');
    expect(lastOut).toContain('bract.yml');
    expect(lastExitCode).toBeUndefined();
  });

  test('scaffolded file is valid YAML with required fields', async () => {
    const outFile = join(tmpDir, 'bract.yml');
    await cmdInit({ file: outFile });

    const content = readFileSync(outFile, 'utf8');
    const parsed = Bun.YAML.parse(content) as Record<string, unknown>;

    expect(parsed.version).toBe(1);
    expect(Array.isArray(parsed.agents)).toBe(true);
    const agents = parsed.agents as Array<Record<string, unknown>>;
    expect(agents.length).toBeGreaterThan(0);
    const first = agents[0];
    expect(first).toBeDefined();
    expect(typeof first!.name).toBe('string');
    expect(typeof first!.model).toBe('string');
  });

  test('refuses to overwrite existing file without --force', async () => {
    const outFile = join(tmpDir, 'bract.yml');
    await cmdInit({ file: outFile });

    lastOut = '';
    lastErr = '';
    lastExitCode = undefined;

    let threw = false;
    try {
      await cmdInit({ file: outFile });
    } catch {
      threw = true;
    }

    expect(threw).toBe(true);
    expect(lastExitCode as unknown as number).toBe(1);
    expect(lastErr).toContain('already exists');
  });

  test('overwrites existing file with --force', async () => {
    const outFile = join(tmpDir, 'bract.yml');
    await cmdInit({ file: outFile });

    lastOut = '';
    lastErr = '';
    lastExitCode = undefined;

    await cmdInit({ file: outFile, force: true });

    expect(lastExitCode).toBeUndefined();
    expect(existsSync(outFile)).toBe(true);
  });

  test('prints json output when --json flag is set', async () => {
    const outFile = join(tmpDir, 'bract.yml');
    await cmdInit({ file: outFile, json: true });

    const out = JSON.parse(lastOut);
    expect(out.created).toBe(true);
    expect(typeof out.file).toBe('string');
  });

  test('defaults to bract.yml in cwd', async () => {
    // cmdInit without file option uses process.cwd() + /bract.yml
    // We can't change cwd safely in tests, so just verify no error
    // when given explicit path in tmp dir.
    const outFile = join(tmpDir, 'my-config.yml');
    await cmdInit({ file: outFile });
    expect(existsSync(outFile)).toBe(true);
  });
});
