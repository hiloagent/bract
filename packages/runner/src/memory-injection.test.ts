import { describe, expect, it, mock, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, readdirSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { send } from '@losoft/bract-runtime';
import { AgentRunner } from './agent-runner.js';

function tmpHome(): string {
  return mkdtempSync(join(tmpdir(), 'bract-runner-mem-test-'));
}

type CapturedRequest = { messages: Array<{ role: string; content: string }> };

function makeMockFetch(replies: string[]): { captured: CapturedRequest[] } {
  const captured: CapturedRequest[] = [];
  let idx = 0;
  globalThis.fetch = mock(async (_url: string, init: any) => {
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

function memoryDir(home: string, name: string) {
  return join(home, 'agents', name, 'memory');
}

/** Wait for the runner to emit `run` or `run:error`. */
function nextRun(runner: AgentRunner): Promise<void> {
  return new Promise<void>((resolve) => {
    runner.once('run', () => resolve());
    runner.once('run:error', () => resolve());
  });
}

describe('AgentRunner — memory injection', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('injects all memory files into system prompt when inject=all', async () => {
    const home = tmpHome();
    const { captured } = makeMockFetch(['ok']);

    // Create memory files
    const memDir = memoryDir(home, 'mem-agent');
    mkdirSync(memDir, { recursive: true });
    writeFileSync(join(memDir, 'prefs.md'), 'User prefers short responses.');
    writeFileSync(join(memDir, 'context.md'), 'Working on bract.');

    const runner = new AgentRunner({
      name: 'mem-agent',
      home,
      model: 'test-model',
      system: 'You are helpful.',
      memory: { inject: 'all' },
    });
    await runner.start();
    await send(inboxDir(home, 'mem-agent'), 'user', 'hi');
    await nextRun(runner);
    runner.stop();

    const systemMsg = captured[0]!.messages[0]!;
    expect(systemMsg.role).toBe('system');
    expect(systemMsg.content).toContain('[Memory — prefs.md]');
    expect(systemMsg.content).toContain('User prefers short responses.');
    expect(systemMsg.content).toContain('[Memory — context.md]');
    expect(systemMsg.content).toContain('Working on bract.');
  });

  it('injects only listed files when inject is an array', async () => {
    const home = tmpHome();
    const { captured } = makeMockFetch(['ok']);

    const memDir = memoryDir(home, 'sel-agent');
    mkdirSync(memDir, { recursive: true });
    writeFileSync(join(memDir, 'prefs.md'), 'User prefers short responses.');
    writeFileSync(join(memDir, 'secret.md'), 'Do not inject this.');

    const runner = new AgentRunner({
      name: 'sel-agent',
      home,
      model: 'test-model',
      memory: { inject: ['prefs.md'] },
    });
    await runner.start();
    await send(inboxDir(home, 'sel-agent'), 'user', 'hi');
    await nextRun(runner);
    runner.stop();

    const systemMsg = captured[0]!.messages[0]!;
    expect(systemMsg.role).toBe('system');
    expect(systemMsg.content).toContain('[Memory — prefs.md]');
    expect(systemMsg.content).not.toContain('secret.md');
    expect(systemMsg.content).not.toContain('Do not inject this.');
  });

  it('does not inject memory when no memory config', async () => {
    const home = tmpHome();
    const { captured } = makeMockFetch(['ok']);

    const memDir = memoryDir(home, 'no-mem-agent');
    mkdirSync(memDir, { recursive: true });
    writeFileSync(join(memDir, 'prefs.md'), 'Should not appear.');

    const runner = new AgentRunner({
      name: 'no-mem-agent',
      home,
      model: 'test-model',
      system: 'Base system.',
    });
    await runner.start();
    await send(inboxDir(home, 'no-mem-agent'), 'user', 'hi');
    await nextRun(runner);
    runner.stop();

    const systemMsg = captured[0]!.messages[0]!;
    expect(systemMsg.content).toBe('Base system.');
  });

  it('truncates files over injectLimitKb with a note', async () => {
    const home = tmpHome();
    const { captured } = makeMockFetch(['ok']);

    const memDir = memoryDir(home, 'trunc-agent');
    mkdirSync(memDir, { recursive: true });
    // Write 3KB file (injectLimitKb=1 = 1024 bytes)
    writeFileSync(join(memDir, 'big.md'), 'x'.repeat(3072));

    const runner = new AgentRunner({
      name: 'trunc-agent',
      home,
      model: 'test-model',
      memory: { inject: 'all', injectLimitKb: 1 },
    });
    await runner.start();
    await send(inboxDir(home, 'trunc-agent'), 'user', 'hi');
    await nextRun(runner);
    runner.stop();

    const systemMsg = captured[0]!.messages[0]!;
    const memBlock = systemMsg.content;
    // Should be truncated to ~1024 chars, not 3072
    expect(memBlock).toContain('[Memory — big.md]');
    expect(memBlock).toContain('truncated');
    // The injected content should be significantly shorter than the original
    const fileContent = memBlock.split('[Memory — big.md]')[1]!;
    expect(fileContent.length).toBeLessThan(2000);
  });

  it('respects injectTotalKb budget across multiple files', async () => {
    const home = tmpHome();
    const { captured } = makeMockFetch(['ok']);

    const memDir = memoryDir(home, 'budget-agent');
    mkdirSync(memDir, { recursive: true });
    // Two 2KB files, total budget = 2KB → only some content should fit
    writeFileSync(join(memDir, 'a.md'), 'a'.repeat(2048));
    writeFileSync(join(memDir, 'b.md'), 'b'.repeat(2048));

    const runner = new AgentRunner({
      name: 'budget-agent',
      home,
      model: 'test-model',
      memory: { inject: 'all', injectTotalKb: 2 },
    });
    await runner.start();
    await send(inboxDir(home, 'budget-agent'), 'user', 'hi');
    await nextRun(runner);
    runner.stop();

    const systemMsg = captured[0]!.messages[0]!;
    const memContent = systemMsg.content;
    // Total memory content should be at most ~2KB + headers overhead
    // The actual text content from files shouldn't exceed 2KB + some overhead
    const aCount = (memContent.match(/a/g) || []).length;
    const bCount = (memContent.match(/b/g) || []).length;
    expect(aCount + bCount).toBeLessThanOrEqual(2100); // 2KB + small overhead
  });

  it('gracefully handles missing memory directory', async () => {
    const home = tmpHome();
    const { captured } = makeMockFetch(['ok']);

    const runner = new AgentRunner({
      name: 'no-dir-agent',
      home,
      model: 'test-model',
      system: 'Base.',
      memory: { inject: 'all' },
    });
    await runner.start();
    await send(inboxDir(home, 'no-dir-agent'), 'user', 'hi');
    await nextRun(runner);
    runner.stop();

    // Should fall back to base system prompt without error
    const systemMsg = captured[0]!.messages[0]!;
    expect(systemMsg.content).toBe('Base.');
  });

  it('caches memory content and only re-reads on mtime change', async () => {
    const home = tmpHome();
    const { captured } = makeMockFetch(['ok-1', 'ok-2', 'ok-3']);

    const memDir = memoryDir(home, 'cache-agent');
    mkdirSync(memDir, { recursive: true });
    writeFileSync(join(memDir, 'note.md'), 'version-1');

    const runner = new AgentRunner({
      name: 'cache-agent',
      home,
      model: 'test-model',
      memory: { inject: 'all' },
    });
    await runner.start();

    // First call — reads the file
    await send(inboxDir(home, 'cache-agent'), 'user', 'msg-1');
    await nextRun(runner);

    // Second call — file unchanged, should use cache
    await send(inboxDir(home, 'cache-agent'), 'user', 'msg-2');
    await nextRun(runner);

    // Update the file with a new mtime
    await new Promise((r) => setTimeout(r, 10)); // small delay ensures different mtime
    writeFileSync(join(memDir, 'note.md'), 'version-2');

    // Third call — file changed, should re-read
    await send(inboxDir(home, 'cache-agent'), 'user', 'msg-3');
    await nextRun(runner);

    runner.stop();

    // First two calls should see version-1
    expect(captured[0]!.messages[0]!.content).toContain('version-1');
    expect(captured[1]!.messages[0]!.content).toContain('version-1');
    // Third call should see version-2
    expect(captured[2]!.messages[0]!.content).toContain('version-2');
  });
});
