import { describe, expect, it, mock, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { send } from '@losoft/bract-runtime';
import { ollamaApiRoot, isModelAvailable, pullModel } from './ollama-pull.js';
import { AgentRunner } from './agent-runner.js';
import type { PullProgressEvent } from './agent-runner.js';

describe('ollamaApiRoot', () => {
  it('strips /v1 suffix', () => {
    expect(ollamaApiRoot('http://localhost:11434/v1')).toBe('http://localhost:11434');
  });

  it('strips /v1/ with trailing slash', () => {
    expect(ollamaApiRoot('http://localhost:11434/v1/')).toBe('http://localhost:11434');
  });

  it('is idempotent for URLs without /v1', () => {
    expect(ollamaApiRoot('http://localhost:11434')).toBe('http://localhost:11434');
  });

  it('works with custom host and port', () => {
    expect(ollamaApiRoot('http://custom:8080/v1')).toBe('http://custom:8080');
  });
});

describe('isModelAvailable', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns true on exact model match', async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ models: [{ name: 'qwen2.5:3b' }] }), { status: 200 }),
    ) as unknown as typeof globalThis.fetch;

    expect(await isModelAvailable('http://localhost:11434', 'qwen2.5:3b')).toBe(true);
  });

  it('returns true when bare name matches model:latest', async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ models: [{ name: 'llama3:latest' }] }), { status: 200 }),
    ) as unknown as typeof globalThis.fetch;

    expect(await isModelAvailable('http://localhost:11434', 'llama3')).toBe(true);
  });

  it('returns false when model is not in the list', async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ models: [{ name: 'llama3:latest' }] }), { status: 200 }),
    ) as unknown as typeof globalThis.fetch;

    expect(await isModelAvailable('http://localhost:11434', 'qwen2.5:3b')).toBe(false);
  });

  it('returns false when models list is empty', async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ models: [] }), { status: 200 }),
    ) as unknown as typeof globalThis.fetch;

    expect(await isModelAvailable('http://localhost:11434', 'qwen2.5:3b')).toBe(false);
  });

  it('throws on HTTP error', async () => {
    globalThis.fetch = mock(async () =>
      new Response('service unavailable', { status: 503 }),
    ) as unknown as typeof globalThis.fetch;

    await expect(isModelAvailable('http://localhost:11434', 'qwen2.5:3b')).rejects.toThrow(
      'failed to list models (HTTP 503)',
    );
  });
});

describe('pullModel', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('yields progress events from NDJSON stream', async () => {
    const ndjson = [
      '{"status":"pulling manifest"}',
      '{"status":"downloading","digest":"sha256:abc","total":1000,"completed":500}',
      '{"status":"success"}',
    ].join('\n');

    globalThis.fetch = mock(async () =>
      new Response(ndjson, { status: 200 }),
    ) as unknown as typeof globalThis.fetch;

    const events = [];
    for await (const evt of pullModel('http://localhost:11434', 'qwen2.5:3b')) {
      events.push(evt);
    }

    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ status: 'pulling manifest' });
    expect(events[1]).toEqual({ status: 'downloading', digest: 'sha256:abc', total: 1000, completed: 500 });
    expect(events[2]).toEqual({ status: 'success' });
  });

  it('throws on HTTP error', async () => {
    globalThis.fetch = mock(async () =>
      new Response('not found', { status: 404 }),
    ) as unknown as typeof globalThis.fetch;

    const gen = pullModel('http://localhost:11434', 'nonexistent');
    await expect(gen.next()).rejects.toThrow("failed to pull model 'nonexistent' (HTTP 404)");
  });

  it('throws on error status in stream', async () => {
    const ndjson = '{"error":"model not found"}\n';

    globalThis.fetch = mock(async () =>
      new Response(ndjson, { status: 200 }),
    ) as unknown as typeof globalThis.fetch;

    const gen = pullModel('http://localhost:11434', 'bad-model');
    await expect(gen.next()).rejects.toThrow("pull failed for 'bad-model': model not found");
  });
});

describe('AgentRunner auto-pull integration', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function tmpHome(): string {
    return mkdtempSync(join(tmpdir(), 'bract-runner-pull-test-'));
  }

  it('emits pull:progress events when model is missing, then completes inference', async () => {
    const home = tmpHome();
    let callIndex = 0;

    const ndjson = [
      '{"status":"pulling manifest"}',
      '{"status":"success"}',
    ].join('\n');

    globalThis.fetch = mock(async (url: string | URL | Request, init?: any) => {
      const urlStr = typeof url === 'string' ? url : url.toString();

      // First call: /api/tags — model not available
      if (urlStr.includes('/api/tags')) {
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      }

      // Second call: /api/pull — stream progress
      if (urlStr.includes('/api/pull')) {
        return new Response(ndjson, { status: 200 });
      }

      // Third call: /v1/chat/completions — inference
      if (urlStr.includes('/chat/completions')) {
        return new Response(
          JSON.stringify({ choices: [{ message: { content: 'model reply' } }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response('not found', { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const runner = new AgentRunner({
      name: 'pull-test',
      home,
      model: 'qwen2.5:3b',
    });

    const pullEvents: PullProgressEvent[] = [];
    runner.on('pull:progress', (evt: PullProgressEvent) => pullEvents.push(evt));

    await runner.start();
    await send(join(home, 'agents', 'pull-test', 'inbox'), 'user', 'hello');

    await new Promise<void>((resolve) => {
      runner.once('run', () => resolve());
    });

    runner.stop();

    expect(pullEvents).toHaveLength(2);
    expect(pullEvents[0]!.status).toBe('pulling manifest');
    expect(pullEvents[0]!.agentName).toBe('pull-test');
    expect(pullEvents[0]!.model).toBe('qwen2.5:3b');
    expect(pullEvents[1]!.status).toBe('success');

    // Verify outbox has the response
    const outbox = join(home, 'agents', 'pull-test', 'outbox');
    const msgs = existsSync(outbox) ? readdirSync(outbox).filter((f) => f.endsWith('.msg')) : [];
    expect(msgs).toHaveLength(1);
  });

  it('skips pull on second message (model already verified)', async () => {
    const home = tmpHome();
    let tagsCallCount = 0;

    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString();

      if (urlStr.includes('/api/tags')) {
        tagsCallCount++;
        return new Response(
          JSON.stringify({ models: [{ name: 'qwen2.5:3b' }] }),
          { status: 200 },
        );
      }

      if (urlStr.includes('/chat/completions')) {
        return new Response(
          JSON.stringify({ choices: [{ message: { content: 'reply' } }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response('not found', { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const runner = new AgentRunner({
      name: 'cache-test',
      home,
      model: 'qwen2.5:3b',
    });

    await runner.start();

    // First message — triggers tags check
    await send(join(home, 'agents', 'cache-test', 'inbox'), 'user', 'msg1');
    await new Promise<void>((resolve) => runner.once('run', () => resolve()));

    // Second message — should skip tags check
    await send(join(home, 'agents', 'cache-test', 'inbox'), 'user', 'msg2');
    await new Promise<void>((resolve) => runner.once('run', () => resolve()));

    runner.stop();

    expect(tagsCallCount).toBe(1);
  });

  it('emits run:error when pull fails', async () => {
    const home = tmpHome();

    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString();

      if (urlStr.includes('/api/tags')) {
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      }

      if (urlStr.includes('/api/pull')) {
        return new Response('model not found', { status: 404 });
      }

      return new Response('not found', { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const runner = new AgentRunner({
      name: 'fail-test',
      home,
      model: 'nonexistent-model',
    });

    await runner.start();
    await send(join(home, 'agents', 'fail-test', 'inbox'), 'user', 'hello');

    const errEvt = await new Promise<any>((resolve) => {
      runner.once('run:error', (evt) => resolve(evt));
    });

    runner.stop();

    expect(errEvt.agentName).toBe('fail-test');
    expect(errEvt.error).toBeInstanceOf(Error);
    expect((errEvt.error as Error).message).toContain("failed to pull model 'nonexistent-model'");
  });
});
