/**
 * @file pipe-router.test.ts
 * Tests for PipeRouter — filesystem forwarding from agent outboxes to inboxes.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { PipeRouter } from './pipe-router.js';
import { reply, listPending, read } from './message.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'bract-pipe-router-test-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function agentDir(name: string) {
  return join(tmp, name);
}

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

describe('PipeRouter', () => {
  it('forwards a message from source outbox to target inbox', async () => {
    setupAgent('alpha');
    setupAgent('beta');

    // Write a message to alpha's outbox
    await reply(outboxDir('alpha'), 'alpha', 'hello from alpha');

    const router = new PipeRouter(tmp, [{ from: 'alpha', to: 'beta' }]);
    await router.poll();

    // beta's inbox should have the message
    const pending = listPending(inboxDir('beta'));
    expect(pending).toHaveLength(1);

    const msg = await read(inboxDir('beta'), pending[0]!);
    expect(msg.body).toBe('hello from alpha');
    expect(msg.metadata.pipedFrom).toBe('alpha');
  });

  it('does not forward the same message twice', async () => {
    setupAgent('alpha');
    setupAgent('beta');

    await reply(outboxDir('alpha'), 'alpha', 'once only');

    const router = new PipeRouter(tmp, [{ from: 'alpha', to: 'beta' }]);
    await router.poll();
    await router.poll();
    await router.poll();

    const pending = listPending(inboxDir('beta'));
    expect(pending).toHaveLength(1);
  });

  it('forwards to multiple targets from the same source', async () => {
    setupAgent('source');
    setupAgent('target-a');
    setupAgent('target-b');

    await reply(outboxDir('source'), 'source', 'broadcast');

    const router = new PipeRouter(tmp, [
      { from: 'source', to: 'target-a' },
      { from: 'source', to: 'target-b' },
    ]);
    await router.poll();

    expect(listPending(inboxDir('target-a'))).toHaveLength(1);
    expect(listPending(inboxDir('target-b'))).toHaveLength(1);
  });

  it('forwards multiple messages in order', async () => {
    setupAgent('source');
    setupAgent('target');

    await reply(outboxDir('source'), 'source', 'first');
    await reply(outboxDir('source'), 'source', 'second');

    const router = new PipeRouter(tmp, [{ from: 'source', to: 'target' }]);
    await router.poll();

    const pending = listPending(inboxDir('target'));
    expect(pending).toHaveLength(2);
  });

  it('applies filter — only forwards messages containing the filter string', async () => {
    setupAgent('source');
    setupAgent('target');

    await reply(outboxDir('source'), 'source', 'ERROR: something broke');
    await reply(outboxDir('source'), 'source', 'INFO: all good');

    const router = new PipeRouter(tmp, [{ from: 'source', to: 'target', filter: 'ERROR' }]);
    await router.poll();

    const pending = listPending(inboxDir('target'));
    expect(pending).toHaveLength(1);

    const msg = await read(inboxDir('target'), pending[0]!);
    expect(msg.body).toContain('ERROR');
  });

  it('does not re-forward a filtered-out message on subsequent polls', async () => {
    setupAgent('source');
    setupAgent('target');

    await reply(outboxDir('source'), 'source', 'INFO: not matching');

    const router = new PipeRouter(tmp, [{ from: 'source', to: 'target', filter: 'ERROR' }]);
    await router.poll();
    await router.poll();

    // Nothing forwarded, but no duplicates or retries
    const pending = listPending(inboxDir('target'));
    expect(pending).toHaveLength(0);

    // Marker file should exist to prevent re-checking
    const pipedDir = join(outboxDir('source'), '.piped', 'target');
    expect(existsSync(pipedDir)).toBe(true);
    expect(readdirSync(pipedDir)).toHaveLength(1);
  });

  it('is restart-safe — does not re-forward after recreating router', async () => {
    setupAgent('source');
    setupAgent('target');

    await reply(outboxDir('source'), 'source', 'delivered once');

    const router1 = new PipeRouter(tmp, [{ from: 'source', to: 'target' }]);
    await router1.poll();

    // Simulate restart with a fresh router instance
    const router2 = new PipeRouter(tmp, [{ from: 'source', to: 'target' }]);
    await router2.poll();

    expect(listPending(inboxDir('target'))).toHaveLength(1);
  });

  it('skips source agents that do not exist yet', async () => {
    setupAgent('target');
    // 'ghost' agent has no directory at all

    const router = new PipeRouter(tmp, [{ from: 'ghost', to: 'target' }]);
    // Should not throw
    await router.poll();

    expect(listPending(inboxDir('target'))).toHaveLength(0);
  });

  it('start/stop controls the poll timer', async () => {
    const router = new PipeRouter(tmp, []);
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
