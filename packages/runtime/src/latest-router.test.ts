/**
 * @file latest-router.test.ts
 * Tests for LatestRouter — delivers combined message whenever any source sends a new message.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LatestRouter } from './latest-router.js';
import { reply, listPending, read } from './message.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'bract-latest-router-test-'));
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

describe('LatestRouter', () => {
  it('does not deliver until all sources have sent at least one message', async () => {
    setupAgent('price-feed');
    setupAgent('news-feed');
    setupAgent('monitor');

    // Only price-feed has sent — no delivery
    await reply(outboxDir('price-feed'), 'price-feed', '50000');

    const router = new LatestRouter(tmp, [
      { mode: 'latest', from: ['price-feed', 'news-feed'], to: 'monitor' },
    ]);
    await router.poll();

    expect(listPending(inboxDir('monitor'))).toHaveLength(0);

    // news-feed sends — now both have contributed, exactly one delivery
    await reply(outboxDir('news-feed'), 'news-feed', 'BTC surges');
    await router.poll();

    const pending = listPending(inboxDir('monitor'));
    expect(pending).toHaveLength(1);

    const msg = await read(inboxDir('monitor'), pending[0]!);
    const body = JSON.parse(msg.body) as Record<string, string>;
    expect(body['price-feed']).toBe('50000');
    expect(body['news-feed']).toBe('BTC surges');
  });

  it('delivers on every new message once all sources have contributed', async () => {
    setupAgent('a');
    setupAgent('b');
    setupAgent('sink');

    // First poll: a and b both send — one delivery (triggered when the second source is processed)
    await reply(outboxDir('a'), 'a', 'a-1');
    await reply(outboxDir('b'), 'b', 'b-1');

    const router = new LatestRouter(tmp, [
      { mode: 'latest', from: ['a', 'b'], to: 'sink' },
    ]);
    await router.poll();

    expect(listPending(inboxDir('sink'))).toHaveLength(1);

    // a sends again — one more delivery, latest-b is still b-1
    await reply(outboxDir('a'), 'a', 'a-2');
    await router.poll();

    const pending = listPending(inboxDir('sink'));
    expect(pending).toHaveLength(2);

    const lastMsg = await read(inboxDir('sink'), pending[1]!);
    const body = JSON.parse(lastMsg.body) as Record<string, string>;
    expect(body['a']).toBe('a-2');
    expect(body['b']).toBe('b-1');
  });

  it('includes latestFrom and latestKey in metadata', async () => {
    setupAgent('feed-x');
    setupAgent('feed-y');
    setupAgent('consumer');

    await reply(outboxDir('feed-x'), 'feed-x', 'x-data');
    await reply(outboxDir('feed-y'), 'feed-y', 'y-data');

    const router = new LatestRouter(tmp, [
      { mode: 'latest', from: ['feed-x', 'feed-y'], to: 'consumer' },
    ]);
    await router.poll();

    const pending = listPending(inboxDir('consumer'));
    expect(pending).toHaveLength(1);

    const msg = await read(inboxDir('consumer'), pending[0]!);
    expect(msg.metadata.latestFrom).toEqual(['feed-x', 'feed-y']);
    expect(typeof msg.metadata.latestKey).toBe('string');
  });

  it('does not re-process messages after restart (restart-safe)', async () => {
    setupAgent('alpha');
    setupAgent('beta');
    setupAgent('sink');

    await reply(outboxDir('alpha'), 'alpha', 'v1');
    await reply(outboxDir('beta'), 'beta', 'v1');

    const router1 = new LatestRouter(tmp, [
      { mode: 'latest', from: ['alpha', 'beta'], to: 'sink' },
    ]);
    await router1.poll();

    const countAfterFirst = listPending(inboxDir('sink')).length;
    expect(countAfterFirst).toBe(1);

    // Simulate restart
    const router2 = new LatestRouter(tmp, [
      { mode: 'latest', from: ['alpha', 'beta'], to: 'sink' },
    ]);
    await router2.poll();

    // Same count — no re-delivery
    expect(listPending(inboxDir('sink'))).toHaveLength(countAfterFirst);
  });

  it('skips sources that do not exist yet', async () => {
    setupAgent('sink');

    const router = new LatestRouter(tmp, [
      { mode: 'latest', from: ['ghost-x', 'ghost-y'], to: 'sink' },
    ]);
    await expect(router.poll()).resolves.toBeUndefined();
    expect(listPending(inboxDir('sink'))).toHaveLength(0);
  });

  it('handles three sources — only delivers after all three have sent', async () => {
    setupAgent('a');
    setupAgent('b');
    setupAgent('c');
    setupAgent('sink');

    await reply(outboxDir('a'), 'a', 'from-a');
    await reply(outboxDir('b'), 'b', 'from-b');

    const router = new LatestRouter(tmp, [
      { mode: 'latest', from: ['a', 'b', 'c'], to: 'sink' },
    ]);
    await router.poll();
    // c hasn't sent yet — no delivery
    expect(listPending(inboxDir('sink'))).toHaveLength(0);

    await reply(outboxDir('c'), 'c', 'from-c');
    await router.poll();

    const pending = listPending(inboxDir('sink'));
    expect(pending).toHaveLength(1);

    const msg = await read(inboxDir('sink'), pending[0]!);
    const body = JSON.parse(msg.body) as Record<string, string>;
    expect(body['a']).toBe('from-a');
    expect(body['b']).toBe('from-b');
    expect(body['c']).toBe('from-c');
  });

  it('start/stop controls the poll timer', () => {
    const router = new LatestRouter(tmp, []);
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
