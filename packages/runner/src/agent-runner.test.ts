import { describe, expect, it, mock, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { send } from '@losoft/bract-runtime';
import { AgentRunner } from './agent-runner.js';

function tmpHome(): string {
  return mkdtempSync(join(tmpdir(), 'bract-runner-test-'));
}

function mockFetch(reply: string) {
  globalThis.fetch = mock(async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: reply } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  ) as unknown as typeof globalThis.fetch;
}

function inboxDir(home: string, name: string) {
  return join(home, 'agents', name, 'inbox');
}

function outboxMessages(home: string, name: string): string[] {
  const outbox = join(home, 'agents', name, 'outbox');
  if (!existsSync(outbox)) return [];
  return readdirSync(outbox).filter((f) => f.endsWith('.msg'));
}

describe('AgentRunner', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('processes an inbox message and writes reply to outbox', async () => {
    const home = tmpHome();
    mockFetch('Hello from the model!');

    const runner = new AgentRunner({
      name: 'test-agent',
      home,
      model: 'test-model',
    });

    await runner.start();

    await send(inboxDir(home, 'test-agent'), 'user', 'ping');

    // Wait for watcher to pick it up
    await new Promise<void>((resolve) => {
      runner.on('run', () => resolve());
    });

    runner.stop();

    const msgs = outboxMessages(home, 'test-agent');
    expect(msgs).toHaveLength(1);

    const raw = readFileSync(join(home, 'agents', 'test-agent', 'outbox', msgs[0]!), 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.body).toBe('Hello from the model!');
    expect(parsed.from).toBe('test-agent');
  });

  it('emits run event with timing and reply', async () => {
    const home = tmpHome();
    mockFetch('pong');

    const runner = new AgentRunner({ name: 'a', home, model: 'm' });
    await runner.start();

    await send(inboxDir(home, 'a'), 'user', 'ping');

    const event = await new Promise<any>((resolve) => {
      runner.on('run', resolve);
    });

    runner.stop();

    expect(event.reply).toBe('pong');
    expect(event.agentName).toBe('a');
    expect(typeof event.durationMs).toBe('number');
  });

  it('emits run:error when model call fails', async () => {
    const home = tmpHome();
    globalThis.fetch = mock(async () => new Response('bad', { status: 500 })) as unknown as typeof globalThis.fetch;

    const runner = new AgentRunner({ name: 'b', home, model: 'm' });
    await runner.start();

    await send(inboxDir(home, 'b'), 'user', 'ping');

    const event = await new Promise<any>((resolve) => {
      runner.on('run:error', resolve);
    });

    runner.stop();
    expect(event.error).toBeInstanceOf(Error);
  });

  it('includes system prompt when provided', async () => {
    const home = tmpHome();
    let capturedBody: any;
    globalThis.fetch = mock(async (_url: string, init: any) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof globalThis.fetch;

    const runner = new AgentRunner({
      name: 'c',
      home,
      model: 'test-model',
      system: 'You are helpful.',
    });
    await runner.start();
    await send(inboxDir(home, 'c'), 'user', 'hi');

    await new Promise<void>((resolve) => { runner.on('run', () => resolve()); });
    runner.stop();

    expect(capturedBody.messages[0]).toEqual({ role: 'system', content: 'You are helpful.' });
    expect(capturedBody.messages[1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('start() is idempotent', async () => {
    const home = tmpHome();
    mockFetch('ok');
    const runner = new AgentRunner({ name: 'd', home, model: 'm' });
    await runner.start();
    await runner.start(); // should not throw
    runner.stop();
    expect(true).toBe(true);
  });
});
