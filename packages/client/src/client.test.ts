/**
 * @file client.test.ts
 * Tests for BractClient and sendMessage.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { BractClient } from './client.js';
import { sendMessage } from './send-message.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(import.meta.dir, `__test_client_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('BractClient', () => {
  it('writes a message file to the agent inbox', async () => {
    const client = new BractClient({ home: tmpDir });
    const msg = await client.send('my-agent', { body: 'hello world' });

    const inboxDir = join(tmpDir, 'agents', 'my-agent', 'inbox');
    expect(existsSync(inboxDir)).toBe(true);

    const files = readdirSync(inboxDir).filter((f) => f.endsWith('.msg'));
    expect(files.length).toBe(1);

    // Returned message has expected shape
    expect(msg.body).toBe('hello world');
    expect(msg.v).toBe(1);
    expect(typeof msg.id).toBe('string');
    expect(typeof msg.ts).toBe('string');
  });

  it('uses "client" as default from value', async () => {
    const client = new BractClient({ home: tmpDir });
    const msg = await client.send('agent-a', { body: 'test' });
    expect(msg.from).toBe('client');
  });

  it('accepts a custom from value', async () => {
    const client = new BractClient({ home: tmpDir });
    const msg = await client.send('agent-a', { body: 'hi', from: 'price-watcher' });
    expect(msg.from).toBe('price-watcher');
  });

  it('attaches metadata to the message', async () => {
    const client = new BractClient({ home: tmpDir });
    const msg = await client.send('agent-a', {
      body: 'with meta',
      metadata: { source: 'test', priority: 1 },
    });
    expect(msg.metadata).toEqual({ source: 'test', priority: 1 });
  });

  it('creates inbox directory if it does not exist', async () => {
    const client = new BractClient({ home: tmpDir });
    const inboxDir = join(tmpDir, 'agents', 'new-agent', 'inbox');
    expect(existsSync(inboxDir)).toBe(false);

    await client.send('new-agent', { body: 'first message' });
    expect(existsSync(inboxDir)).toBe(true);
  });

  it('can send multiple messages to the same agent', async () => {
    const client = new BractClient({ home: tmpDir });
    await client.send('agent-b', { body: 'first' });
    await client.send('agent-b', { body: 'second' });
    await client.send('agent-b', { body: 'third' });

    const inboxDir = join(tmpDir, 'agents', 'agent-b', 'inbox');
    const files = readdirSync(inboxDir).filter((f) => f.endsWith('.msg'));
    expect(files.length).toBe(3);
  });

  it('throws when no home is given and BRACT_HOME is not set', () => {
    const orig = process.env.BRACT_HOME;
    delete process.env.BRACT_HOME;
    expect(() => new BractClient()).toThrow('no home directory specified');
    if (orig !== undefined) process.env.BRACT_HOME = orig;
  });

  it('falls back to BRACT_HOME env var when no home option is provided', async () => {
    const orig = process.env.BRACT_HOME;
    process.env.BRACT_HOME = tmpDir;
    try {
      const client = new BractClient();
      const msg = await client.send('env-agent', { body: 'from env' });
      expect(msg.body).toBe('from env');
    } finally {
      if (orig !== undefined) process.env.BRACT_HOME = orig;
      else delete process.env.BRACT_HOME;
    }
  });
});

describe('sendMessage', () => {
  it('writes a message file to the agent inbox', async () => {
    await sendMessage('target-agent', { home: tmpDir, body: 'quick send' });

    const inboxDir = join(tmpDir, 'agents', 'target-agent', 'inbox');
    const files = readdirSync(inboxDir).filter((f) => f.endsWith('.msg'));
    expect(files.length).toBe(1);
  });

  it('returns void', async () => {
    const result = await sendMessage('agent-x', { home: tmpDir, body: 'test' });
    expect(result).toBeUndefined();
  });

  it('message file contains valid JSON with correct body', async () => {
    await sendMessage('json-agent', { home: tmpDir, body: 'check json' });

    const inboxDir = join(tmpDir, 'agents', 'json-agent', 'inbox');
    const files = readdirSync(inboxDir).filter((f) => f.endsWith('.msg'));
    const content = await Bun.file(join(inboxDir, files[0]!)).text();
    const parsed = JSON.parse(content);
    expect(parsed.body).toBe('check json');
    expect(parsed.v).toBe(1);
  });
});
