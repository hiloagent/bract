/**
 * @file cli.test.ts
 * Integration tests for bract CLI commands (ps, send, inbox, read).
 * Tests run against a real tmp BRACT_HOME — no mocks of filesystem or runtime.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProcessTable, send } from '@losoft/bract-runtime';
import { cmdPs } from './cmd-ps.js';
import { cmdSend } from './cmd-send.js';
import { cmdInbox } from './cmd-inbox.js';
import { cmdRead } from './cmd-read.js';

/** Capture stdout/stderr produced by an async function. */
async function capture(fn: () => void | Promise<void>): Promise<{ out: string; err: string }> {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  (process.stdout as any).write = (s: string) => { outChunks.push(s); return true; };
  (process.stderr as any).write = (s: string) => { errChunks.push(s); return true; };
  try {
    await fn();
  } finally {
    (process.stdout as any).write = origOut;
    (process.stderr as any).write = origErr;
  }
  return { out: outChunks.join(''), err: errChunks.join('') };
}

/** Run an async fn, intercept process.exit, and return the exit code. */
async function withExitOverride(fn: () => Promise<void>): Promise<number | undefined> {
  let code: number | undefined;
  const orig = process.exit.bind(process);
  (process as any).exit = (c?: number) => { code = c; throw new Error(`__exit_${c}`); };
  try {
    await fn();
  } catch (e) {
    if (!(e instanceof Error && e.message.startsWith('__exit_'))) throw e;
  } finally {
    (process as any).exit = orig;
  }
  return code;
}

describe('bract ps', () => {
  let tmpHome: string;
  let pt: ProcessTable;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'bract-ps-'));
    pt = new ProcessTable(tmpHome);
  });

  afterEach(() => { rmSync(tmpHome, { recursive: true, force: true }); });

  it('prints "No agents" when empty', async () => {
    const { out } = await capture(() => cmdPs({ home: tmpHome }));
    expect(out).toContain('No agents');
  });

  it('lists registered agents', async () => {
    pt.register('scout', 'qwen2.5:3b');
    const { out } = await capture(() => cmdPs({ home: tmpHome }));
    expect(out).toContain('scout');
    expect(out).toContain('qwen2.5:3b');
    expect(out).toContain('idle');
  });

  it('outputs valid JSON with --json flag', async () => {
    pt.register('scout', 'qwen2.5:3b');
    const { out } = await capture(() => cmdPs({ home: tmpHome, json: true }));
    const parsed = JSON.parse(out) as Array<{ name: string }>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]?.name).toBe('scout');
  });
});

describe('bract send', () => {
  let tmpHome: string;
  let pt: ProcessTable;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'bract-send-'));
    pt = new ProcessTable(tmpHome);
  });

  afterEach(() => { rmSync(tmpHome, { recursive: true, force: true }); });

  it('writes a message to the agent inbox', async () => {
    pt.register('scout', 'qwen2.5:3b');
    const { out } = await capture(() => cmdSend('scout', 'hello world', { home: tmpHome }));
    expect(out).toContain('sent');
    expect(out).toContain('scout');
    const inboxDir = join(tmpHome, 'agents', 'scout', 'inbox');
    const files = readdirSync(inboxDir).filter((f: string) => f.endsWith('.msg'));
    expect(files.length).toBe(1);
  });

  it('respects --from option', async () => {
    pt.register('scout', 'qwen2.5:3b');
    await capture(() => cmdSend('scout', 'ping', { home: tmpHome, from: 'orchestrator' }));
    const { out } = await capture(() => cmdInbox('scout', { home: tmpHome }));
    expect(out).toContain('orchestrator');
  });

  it('exits with code 3 for unknown agent', async () => {
    const code = await withExitOverride(async () => {
      await capture(() => cmdSend('ghost', 'hi', { home: tmpHome }));
    });
    expect(code).toBe(3);
  });
});

describe('bract inbox', () => {
  let tmpHome: string;
  let pt: ProcessTable;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'bract-inbox-'));
    pt = new ProcessTable(tmpHome);
  });

  afterEach(() => { rmSync(tmpHome, { recursive: true, force: true }); });

  it('shows pending messages', async () => {
    pt.register('scout', 'qwen2.5:3b');
    const inboxDir = join(tmpHome, 'agents', 'scout', 'inbox');
    await send(inboxDir, 'cli', 'scan the news');
    const { out } = await capture(() => cmdInbox('scout', { home: tmpHome }));
    expect(out).toContain('INBOX');
    expect(out).toContain('scout');
    expect(out).toContain('scan the news');
    expect(out).toContain('cli');
  });

  it('shows (empty) when no messages', async () => {
    pt.register('scout', 'qwen2.5:3b');
    const { out } = await capture(() => cmdInbox('scout', { home: tmpHome }));
    expect(out).toContain('(empty)');
  });

  it('exits with code 3 for unknown agent', async () => {
    const code = await withExitOverride(async () => {
      await capture(() => cmdInbox('ghost', { home: tmpHome }));
    });
    expect(code).toBe(3);
  });
});

describe('bract read', () => {
  let tmpHome: string;
  let pt: ProcessTable;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'bract-read-'));
    pt = new ProcessTable(tmpHome);
  });

  afterEach(() => { rmSync(tmpHome, { recursive: true, force: true }); });

  it('shows (empty) when outbox is empty', async () => {
    pt.register('scout', 'qwen2.5:3b');
    const { out } = await capture(() => cmdRead('scout', { home: tmpHome }));
    expect(out).toContain('OUTBOX');
    expect(out).toContain('(empty)');
  });

  it('shows only the latest outbox message by default', async () => {
    pt.register('scout', 'qwen2.5:3b');
    const outboxDir = join(tmpHome, 'agents', 'scout', 'outbox');
    await send(outboxDir, 'scout', 'first reply');
    await send(outboxDir, 'scout', 'second reply');
    const { out } = await capture(() => cmdRead('scout', { home: tmpHome }));
    expect(out).toContain('second reply');
    expect(out).not.toContain('first reply');
  });

  it('shows all messages with --all', async () => {
    pt.register('scout', 'qwen2.5:3b');
    const outboxDir = join(tmpHome, 'agents', 'scout', 'outbox');
    await send(outboxDir, 'scout', 'first reply');
    await send(outboxDir, 'scout', 'second reply');
    const { out } = await capture(() => cmdRead('scout', { home: tmpHome, all: true }));
    expect(out).toContain('first reply');
    expect(out).toContain('second reply');
  });

  it('exits with code 3 for unknown agent', async () => {
    const code = await withExitOverride(async () => {
      await capture(() => cmdRead('ghost', { home: tmpHome }));
    });
    expect(code).toBe(3);
  });
});
