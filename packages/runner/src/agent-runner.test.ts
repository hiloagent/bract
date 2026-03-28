import { describe, expect, it, mock, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { send } from '@losoft/bract-runtime';
import { AgentRunner } from './agent-runner.js';

function tmpHome(): string {
  return mkdtempSync(join(tmpdir(), 'bract-runner-test-'));
}

type CapturedRequest = { messages: Array<{ role: string; content: string }> };

function makeMockFetch(replies: string[]): { captured: CapturedRequest[] } {
  const captured: CapturedRequest[] = [];
  let idx = 0;
  globalThis.fetch = mock(async (url: string | URL | Request, init?: any) => {
    const urlStr = typeof url === 'string' ? url : url.toString();

    // Handle Ollama native API calls from auto-pull logic
    if (urlStr.includes('/api/tags')) {
      return new Response(JSON.stringify({ models: [{ name: 'test-model' }, { name: 'm:latest' }] }), { status: 200 });
    }

    captured.push(JSON.parse(init.body as string));
    const content = replies[idx++] ?? 'fallback';
    return new Response(
      JSON.stringify({ choices: [{ message: { content } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as unknown as typeof globalThis.fetch;
  return { captured };
}

function inboxDir(home: string, name: string) {
  return join(home, 'agents', name, 'inbox');
}

function outboxMessages(home: string, name: string): string[] {
  const outbox = join(home, 'agents', name, 'outbox');
  if (!existsSync(outbox)) return [];
  return readdirSync(outbox).filter((f) => f.endsWith('.msg'));
}

/** Wait for the runner to emit `run` or `run:error`. */
function nextRun(runner: AgentRunner): Promise<void> {
  return new Promise<void>((resolve) => {
    runner.once('run', () => resolve());
    runner.once('run:error', () => resolve());
  });
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
    makeMockFetch(['Hello from the model!']);

    const runner = new AgentRunner({
      name: 'test-agent',
      home,
      model: 'test-model',
    });

    await runner.start();

    await send(inboxDir(home, 'test-agent'), 'user', 'ping');

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
    makeMockFetch(['pong']);

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
    const { captured } = makeMockFetch(['ok']);

    const runner = new AgentRunner({
      name: 'c',
      home,
      model: 'test-model',
      system: 'You are helpful.',
    });
    await runner.start();
    await send(inboxDir(home, 'c'), 'user', 'hi');

    await nextRun(runner);
    runner.stop();

    expect(captured[0]!.messages[0]).toEqual({ role: 'system', content: 'You are helpful.' });
    expect(captured[0]!.messages[1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('start() is idempotent', async () => {
    const home = tmpHome();
    makeMockFetch(['ok']);
    const runner = new AgentRunner({ name: 'd', home, model: 'm' });
    await runner.start();
    await runner.start(); // should not throw
    runner.stop();
    expect(true).toBe(true);
  });

  // ── conversation history ──────────────────────────────────────────────────

  it('stateless by default — no history included in second API call', async () => {
    const home = tmpHome();
    const { captured } = makeMockFetch(['reply-1', 'reply-2']);

    const runner = new AgentRunner({ name: 'h0', home, model: 'm' });
    await runner.start();

    await send(inboxDir(home, 'h0'), 'user', 'turn-1');
    await nextRun(runner);

    await send(inboxDir(home, 'h0'), 'user', 'turn-2');
    await nextRun(runner);

    runner.stop();

    // Second call should only contain the current user message — no history
    const msgs2 = captured[1]!.messages;
    expect(msgs2).toEqual([{ role: 'user', content: 'turn-2' }]);
  });

  it('includes previous turns when maxHistory > 0', async () => {
    const home = tmpHome();
    const { captured } = makeMockFetch(['reply-A', 'reply-B', 'reply-C']);

    const runner = new AgentRunner({ name: 'h1', home, model: 'm', maxHistory: 10 });
    await runner.start();

    await send(inboxDir(home, 'h1'), 'user', 'msg-1');
    await nextRun(runner);

    await send(inboxDir(home, 'h1'), 'user', 'msg-2');
    await nextRun(runner);

    await send(inboxDir(home, 'h1'), 'user', 'msg-3');
    await nextRun(runner);

    runner.stop();

    // First call: only msg-1, no history yet
    expect(captured[0]!.messages).toEqual([
      { role: 'user', content: 'msg-1' },
    ]);

    // Second call: history has [user:msg-1, assistant:reply-A] prepended
    expect(captured[1]!.messages).toEqual([
      { role: 'user', content: 'msg-1' },
      { role: 'assistant', content: 'reply-A' },
      { role: 'user', content: 'msg-2' },
    ]);

    // Third call: history has 4 entries (two prior turns)
    expect(captured[2]!.messages).toEqual([
      { role: 'user', content: 'msg-1' },
      { role: 'assistant', content: 'reply-A' },
      { role: 'user', content: 'msg-2' },
      { role: 'assistant', content: 'reply-B' },
      { role: 'user', content: 'msg-3' },
    ]);
  });

  it('drops oldest entries when history overflows', async () => {
    const home = tmpHome();
    const { captured } = makeMockFetch(['r0', 'r1', 'r2', 'r3']);

    // maxHistory=2 → only 2 most-recent history entries kept
    const runner = new AgentRunner({ name: 'h2', home, model: 'm', maxHistory: 2 });
    await runner.start();

    for (const msg of ['m1', 'm2', 'm3', 'm4']) {
      await send(inboxDir(home, 'h2'), 'user', msg);
      await nextRun(runner);
    }

    runner.stop();

    // After m1: history=[user:m1, asst:r0] (2 entries, at limit)
    // After m2: try to add [user:m2, asst:r1] → 4 entries → trim to 2: [user:m2, asst:r1]
    // After m3: try to add [user:m3, asst:r2] → 4 entries → trim to 2: [user:m3, asst:r2]
    // Call for m4 should see history=[user:m3, asst:r2] + current user:m4
    expect(captured[3]!.messages).toEqual([
      { role: 'user', content: 'm3' },
      { role: 'assistant', content: 'r2' },
      { role: 'user', content: 'm4' },
    ]);
  });
});
