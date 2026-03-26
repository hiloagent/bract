import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProcessTable, send } from '@losoft/bract-runtime';
import { cmdPs } from './cmd-ps.js';
import { cmdSend } from './cmd-send.js';
import { cmdInbox } from './cmd-inbox.js';
import { cmdRead } from './cmd-read.js';

/** Capture stdout/stderr from a synchronous function. */
function capture(fn: () => void): { out: string; err: string } {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  (process.stdout as NodeJS.WriteStream).write = (s: string) => { outChunks.push(s); return true; };
  (process.stderr as NodeJS.WriteStream).write = (s: string) => { errChunks.push(s); return true; };
  try {
    fn();
  } finally {
    (process.stdout as NodeJS.WriteStream).write = origOut as typeof process.stdout.write;
    (process.stderr as NodeJS.WriteStream).write = origErr as typeof process.stderr.write;
  }
  return { out: outChunks.join(''), err: errChunks.join('') };
}

/** Call fn; intercept process.exit; return the exit code. */
function withExitOverride(fn: () => void): number | undefined {
  let code: number | undefined;
  const orig = process.exit.bind(process);
  process.exit = (c?: number) => { code = c; throw new Error(`__exit_${c}`); };
  try {
    fn();
  } catch (e) {
    if (!(e instanceof Error && e.message.startsWith('__exit_'))) throw e;
  } finally {
    process.exit = orig;
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

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it('prints "No agents" when empty', () => {
    const { out } = capture(() => cmdPs({ home: tmpHome }));
    assert.ok(out.includes('No agents'));
  });

  it('lists registered agents', () => {
    pt.register('scout', 'qwen2.5:3b');
    const { out } = capture(() => cmdPs({ home: tmpHome }));
    assert.ok(out.includes('scout'));
    assert.ok(out.includes('qwen2.5:3b'));
    assert.ok(out.includes('idle'));
  });

  it('outputs valid JSON with --json flag', () => {
    pt.register('scout', 'qwen2.5:3b');
    const { out } = capture(() => cmdPs({ home: tmpHome, json: true }));
    const parsed = JSON.parse(out) as Array<{ name: string }>;
    assert.ok(Array.isArray(parsed));
    assert.equal(parsed[0]?.name, 'scout');
  });
});

describe('bract send', () => {
  let tmpHome: string;
  let pt: ProcessTable;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'bract-send-'));
    pt = new ProcessTable(tmpHome);
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it('writes a message to the agent inbox', () => {
    pt.register('scout', 'qwen2.5:3b');
    const { out } = capture(() => cmdSend('scout', 'hello world', { home: tmpHome }));
    assert.ok(out.includes('sent'));
    assert.ok(out.includes('scout'));

    const inboxDir = join(tmpHome, 'agents', 'scout', 'inbox');
    const files = readdirSync(inboxDir).filter((f: string) => f.endsWith('.msg'));
    assert.equal(files.length, 1);
  });

  it('respects --from option', () => {
    pt.register('scout', 'qwen2.5:3b');
    capture(() => cmdSend('scout', 'ping', { home: tmpHome, from: 'orchestrator' }));
    const { out } = capture(() => cmdInbox('scout', { home: tmpHome }));
    assert.ok(out.includes('orchestrator'));
  });

  it('exits with code 3 for unknown agent', () => {
    const code = withExitOverride(() =>
      capture(() => cmdSend('ghost', 'hi', { home: tmpHome })),
    );
    assert.equal(code, 3);
  });
});

describe('bract inbox', () => {
  let tmpHome: string;
  let pt: ProcessTable;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'bract-inbox-'));
    pt = new ProcessTable(tmpHome);
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it('shows pending messages', () => {
    pt.register('scout', 'qwen2.5:3b');
    const inboxDir = join(tmpHome, 'agents', 'scout', 'inbox');
    send(inboxDir, 'cli', 'scan the news');

    const { out } = capture(() => cmdInbox('scout', { home: tmpHome }));
    assert.ok(out.includes('INBOX'));
    assert.ok(out.includes('scout'));
    assert.ok(out.includes('scan the news'));
    assert.ok(out.includes('cli'));
  });

  it('shows (empty) when no messages', () => {
    pt.register('scout', 'qwen2.5:3b');
    const { out } = capture(() => cmdInbox('scout', { home: tmpHome }));
    assert.ok(out.includes('(empty)'));
  });

  it('exits with code 3 for unknown agent', () => {
    const code = withExitOverride(() =>
      capture(() => cmdInbox('ghost', { home: tmpHome })),
    );
    assert.equal(code, 3);
  });
});

describe('bract read', () => {
  let tmpHome: string;
  let pt: ProcessTable;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'bract-read-'));
    pt = new ProcessTable(tmpHome);
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it('shows (empty) when outbox is empty', () => {
    pt.register('scout', 'qwen2.5:3b');
    const { out } = capture(() => cmdRead('scout', { home: tmpHome }));
    assert.ok(out.includes('OUTBOX'));
    assert.ok(out.includes('(empty)'));
  });

  it('shows only the latest outbox message by default', () => {
    pt.register('scout', 'qwen2.5:3b');
    const outboxDir = join(tmpHome, 'agents', 'scout', 'outbox');
    send(outboxDir, 'scout', 'first reply');
    send(outboxDir, 'scout', 'second reply');

    const { out } = capture(() => cmdRead('scout', { home: tmpHome }));
    assert.ok(out.includes('second reply'));
    assert.ok(!out.includes('first reply'));
  });

  it('shows all messages with --all', () => {
    pt.register('scout', 'qwen2.5:3b');
    const outboxDir = join(tmpHome, 'agents', 'scout', 'outbox');
    send(outboxDir, 'scout', 'first reply');
    send(outboxDir, 'scout', 'second reply');

    const { out } = capture(() => cmdRead('scout', { home: tmpHome, all: true }));
    assert.ok(out.includes('first reply'));
    assert.ok(out.includes('second reply'));
  });

  it('exits with code 3 for unknown agent', () => {
    const code = withExitOverride(() =>
      capture(() => cmdRead('ghost', { home: tmpHome })),
    );
    assert.equal(code, 3);
  });
});
