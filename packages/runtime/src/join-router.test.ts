/**
 * @file join-router.test.ts
 * Tests for JoinRouter — waits for one message from each source, then delivers combined.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { JoinRouter } from './join-router.js';
import { reply, listPending, read } from './message.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'bract-join-router-test-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function outboxDir(name: string) {
  return join(tmp, name, 'outbox');
}

function inboxDir(name: string) {
  return join(tmp, name, 'inbox');
}

function setupAgent(name: string) {
  mkdirSync(join(tmp, name, 'outbox'), { recursive: true });
  mkdirSync(join(tmp, name, 'inbox'), { recursive: true });
}

describe('JoinRouter', () => {
  it('delivers a combined message when all sources have contributed', async () => {
    setupAgent('fetcher-a');
    setupAgent('fetcher-b');
    setupAgent('aggregator');

    await reply(outboxDir('fetcher-a'), 'fetcher-a', 'result from A');
    await reply(outboxDir('fetcher-b'), 'fetcher-b', 'result from B');

    const router = new JoinRouter(tmp, [
      { mode: 'join', from: ['fetcher-a', 'fetcher-b'], to: 'aggregator' },
    ]);
    await router.poll();

    const pending = listPending(inboxDir('aggregator'));
    expect(pending).toHaveLength(1);

    const msg = await read(inboxDir('aggregator'), pending[0]!);
    const body = JSON.parse(msg.body) as Record<string, string>;
    expect(body['fetcher-a']).toBe('result from A');
    expect(body['fetcher-b']).toBe('result from B');
    expect(msg.metadata.joinFrom).toEqual(['fetcher-a', 'fetcher-b']);
  });

  it('does not deliver until all sources have contributed', async () => {
    setupAgent('fetcher-a');
    setupAgent('fetcher-b');
    setupAgent('aggregator');

    // Only fetcher-a has sent a message
    await reply(outboxDir('fetcher-a'), 'fetcher-a', 'result from A');

    const router = new JoinRouter(tmp, [
      { mode: 'join', from: ['fetcher-a', 'fetcher-b'], to: 'aggregator' },
    ]);
    await router.poll();

    expect(listPending(inboxDir('aggregator'))).toHaveLength(0);

    // Now fetcher-b sends
    await reply(outboxDir('fetcher-b'), 'fetcher-b', 'result from B');
    await router.poll();

    const pending = listPending(inboxDir('aggregator'));
    expect(pending).toHaveLength(1);

    const msg = await read(inboxDir('aggregator'), pending[0]!);
    const body = JSON.parse(msg.body) as Record<string, string>;
    expect(body['fetcher-a']).toBe('result from A');
    expect(body['fetcher-b']).toBe('result from B');
  });

  it('delivers multiple join sets when each source sends multiple messages', async () => {
    setupAgent('source-a');
    setupAgent('source-b');
    setupAgent('sink');

    // Two messages from each source
    await reply(outboxDir('source-a'), 'source-a', 'A-1');
    await reply(outboxDir('source-b'), 'source-b', 'B-1');
    await reply(outboxDir('source-a'), 'source-a', 'A-2');
    await reply(outboxDir('source-b'), 'source-b', 'B-2');

    const router = new JoinRouter(tmp, [
      { mode: 'join', from: ['source-a', 'source-b'], to: 'sink' },
    ]);
    await router.poll();

    const pending = listPending(inboxDir('sink'));
    expect(pending).toHaveLength(2);

    const msg1 = await read(inboxDir('sink'), pending[0]!);
    const msg2 = await read(inboxDir('sink'), pending[1]!);
    const body1 = JSON.parse(msg1.body) as Record<string, string>;
    const body2 = JSON.parse(msg2.body) as Record<string, string>;

    // First join: A-1 + B-1, second join: A-2 + B-2
    expect(body1['source-a']).toBe('A-1');
    expect(body1['source-b']).toBe('B-1');
    expect(body2['source-a']).toBe('A-2');
    expect(body2['source-b']).toBe('B-2');
  });

  it('does not re-deliver after recreating the router (restart-safe)', async () => {
    setupAgent('alpha');
    setupAgent('beta');
    setupAgent('sink');

    await reply(outboxDir('alpha'), 'alpha', 'hello');
    await reply(outboxDir('beta'), 'beta', 'world');

    const router1 = new JoinRouter(tmp, [
      { mode: 'join', from: ['alpha', 'beta'], to: 'sink' },
    ]);
    await router1.poll();

    expect(listPending(inboxDir('sink'))).toHaveLength(1);

    // Simulate restart
    const router2 = new JoinRouter(tmp, [
      { mode: 'join', from: ['alpha', 'beta'], to: 'sink' },
    ]);
    await router2.poll();

    // Still only 1 message
    expect(listPending(inboxDir('sink'))).toHaveLength(1);
  });

  it('skips sources that do not exist yet', async () => {
    setupAgent('sink');
    // 'ghost-a' and 'ghost-b' do not exist

    const router = new JoinRouter(tmp, [
      { mode: 'join', from: ['ghost-a', 'ghost-b'], to: 'sink' },
    ]);
    await expect(router.poll()).resolves.toBeUndefined();
    expect(listPending(inboxDir('sink'))).toHaveLength(0);
  });

  it('handles three sources', async () => {
    setupAgent('a');
    setupAgent('b');
    setupAgent('c');
    setupAgent('combined');

    await reply(outboxDir('a'), 'a', 'from-a');
    await reply(outboxDir('b'), 'b', 'from-b');
    await reply(outboxDir('c'), 'c', 'from-c');

    const router = new JoinRouter(tmp, [
      { mode: 'join', from: ['a', 'b', 'c'], to: 'combined' },
    ]);
    await router.poll();

    const pending = listPending(inboxDir('combined'));
    expect(pending).toHaveLength(1);

    const msg = await read(inboxDir('combined'), pending[0]!);
    const body = JSON.parse(msg.body) as Record<string, string>;
    expect(body['a']).toBe('from-a');
    expect(body['b']).toBe('from-b');
    expect(body['c']).toBe('from-c');
  });

  it('start/stop controls the poll timer', () => {
    const router = new JoinRouter(tmp, []);
    expect(router.running).toBe(false);
    router.start();
    expect(router.running).toBe(true);
    router.start(); // idempotent
    expect(router.running).toBe(true);
    router.stop();
    expect(router.running).toBe(false);
    router.stop(); // idempotent
    expect(router.running).toBe(false);
  });
});
