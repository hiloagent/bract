/**
 * @file tests/e2e/tier2-lifecycle.test.ts
 * Tier 2 — Agent lifecycle tests. Requires the compiled binary (spawn creates
 * a detached subprocess). Uses mock LLM server so no Ollama is needed.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cli } from './helpers/cli.ts';
import { makeFixture, type Fixture } from './helpers/fixtures.ts';
import { startMockLLM, type MockLLMServer } from './helpers/mock-llm-server.ts';
import {
  trackAgentPid,
  killAll,
  isAlive,
  waitForFile,
  waitForDeath,
} from './helpers/process-cleanup.ts';

let fx: Fixture;
let llm: MockLLMServer;

beforeEach(async () => {
  fx = makeFixture([{ name: 'assistant', model: 'mock-model', restart: 'never' }]);
  llm = await startMockLLM();
  llm.setFixed('I am the mock reply.');
});

afterEach(() => {
  killAll();
  fx.cleanup();
  llm.stop();
});

// ── spawn / ps ────────────────────────────────────────────────────────────────

describe('agent spawn', () => {
  test('TC-L1: spawn --detach reports pid', async () => {
    const r = await cli(
      ['spawn', 'assistant', '--detach', '--file', fx.configPath],
      { env: { ...fx.env, BRACT_AGENT_BASE_URL: llm.baseUrl }, cwd: fx.home },
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/spawned assistant \(pid \d+\)/);
  });

  test('TC-L2: spawned agent appears in ps as running', async () => {
    await cli(
      ['spawn', 'assistant', '--detach', '--file', fx.configPath],
      { env: { ...fx.env, BRACT_AGENT_BASE_URL: llm.baseUrl }, cwd: fx.home },
    );
    await Bun.sleep(500);
    const r = await cli(['ps'], { env: fx.env });
    expect(r.stdout).toContain('assistant');
    expect(r.stdout).toMatch(/running/i);
  });

  test('TC-L3: spawned agent writes pid file', async () => {
    await cli(
      ['spawn', 'assistant', '--detach', '--file', fx.configPath],
      { env: { ...fx.env, BRACT_AGENT_BASE_URL: llm.baseUrl }, cwd: fx.home },
    );
    const pidFile = join(fx.home, 'agents', 'assistant', 'pid');
    const appeared = await waitForFile(pidFile, 5000);
    expect(appeared).toBe(true);

    const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
    trackAgentPid(fx.home, 'assistant');
    expect(isAlive(pid)).toBe(true);
  });

  test('TC-L4: spawned agent stays alive after 3s', async () => {
    await cli(
      ['spawn', 'assistant', '--detach', '--file', fx.configPath],
      { env: { ...fx.env, BRACT_AGENT_BASE_URL: llm.baseUrl }, cwd: fx.home },
    );
    const pidFile = join(fx.home, 'agents', 'assistant', 'pid');
    await waitForFile(pidFile, 5000);
    const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
    trackAgentPid(fx.home, 'assistant');

    await Bun.sleep(3000);
    expect(isAlive(pid)).toBe(true);
  });

  test('TC-L5: spawn --json outputs JSON', async () => {
    const r = await cli(
      ['spawn', 'assistant', '--detach', '--json', '--file', fx.configPath],
      { env: { ...fx.env, BRACT_AGENT_BASE_URL: llm.baseUrl }, cwd: fx.home },
    );
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.name).toBe('assistant');
    expect(typeof parsed.pid).toBe('number');
    trackAgentPid(fx.home, 'assistant');
  });

  test('TC-L6: spawn unknown agent exits non-zero', async () => {
    const r = await cli(
      ['spawn', 'nonexistent', '--detach', '--file', fx.configPath],
      { env: fx.env, cwd: fx.home },
    );
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/unknown agent|not found/i);
  });
});

// ── message processing ────────────────────────────────────────────────────────

describe('message processing', () => {
  test('TC-L7: agent processes inbox message and writes to outbox', async () => {
    llm.enqueue({ content: 'The answer is 42.' });

    await cli(
      ['spawn', 'assistant', '--detach', '--file', fx.configPath],
      { env: { ...fx.env, BRACT_AGENT_BASE_URL: llm.baseUrl }, cwd: fx.home },
    );
    const pidFile = join(fx.home, 'agents', 'assistant', 'pid');
    await waitForFile(pidFile, 5000);
    trackAgentPid(fx.home, 'assistant');

    await cli(['send', 'assistant', 'What is the answer?'], { env: fx.env });

    // Wait for outbox message to appear
    const outboxDir = join(fx.home, 'agents', 'assistant', 'outbox');
    const appeared = await waitForFile(outboxDir, 8000);
    expect(appeared).toBe(true);

    // Poll for actual file in outbox
    let outboxFile: string | null = null;
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const files = existsSync(outboxDir)
        ? require('node:fs').readdirSync(outboxDir).filter((f: string) => f.endsWith('.msg'))
        : [];
      if (files.length > 0) { outboxFile = files[0]; break; }
      await Bun.sleep(200);
    }
    expect(outboxFile).not.toBeNull();

    const r = await cli(['read', 'assistant'], { env: fx.env });
    expect(r.stdout).toContain('The answer is 42.');
    expect(llm.requestCount).toBe(1);
  });

  test('TC-L8: agent processes multiple messages sequentially', async () => {
    llm.enqueue({ content: 'Reply one.' });
    llm.enqueue({ content: 'Reply two.' });

    await cli(
      ['spawn', 'assistant', '--detach', '--file', fx.configPath],
      { env: { ...fx.env, BRACT_AGENT_BASE_URL: llm.baseUrl }, cwd: fx.home },
    );
    const pidFile = join(fx.home, 'agents', 'assistant', 'pid');
    await waitForFile(pidFile, 5000);
    trackAgentPid(fx.home, 'assistant');

    await cli(['send', 'assistant', 'msg1'], { env: fx.env });
    await cli(['send', 'assistant', 'msg2'], { env: fx.env });

    // Wait for 2 outbox messages
    const outboxDir = join(fx.home, 'agents', 'assistant', 'outbox');
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      if (existsSync(outboxDir)) {
        const files = require('node:fs').readdirSync(outboxDir).filter((f: string) => f.endsWith('.msg'));
        if (files.length >= 2) break;
      }
      await Bun.sleep(300);
    }
    expect(llm.requestCount).toBeGreaterThanOrEqual(2);
  });

  test('TC-L9: SIGTERM shuts down agent cleanly', async () => {
    await cli(
      ['spawn', 'assistant', '--detach', '--file', fx.configPath],
      { env: { ...fx.env, BRACT_AGENT_BASE_URL: llm.baseUrl }, cwd: fx.home },
    );
    const pidFile = join(fx.home, 'agents', 'assistant', 'pid');
    await waitForFile(pidFile, 5000);
    const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);

    // Give the worker time to register signal handlers.
    // spawnDetached writes the pid file from the CLI before the worker executes,
    // so the pid can appear before process.once('SIGTERM') is registered.
    await Bun.sleep(500);

    process.kill(pid, 'SIGTERM');
    const died = await waitForDeath(pid, 3000);
    expect(died).toBe(true);

    // Status should be updated to dead — give more time for the handler to write it
    await Bun.sleep(1000);
    const status = readFileSync(join(fx.home, 'agents', 'assistant', 'status'), 'utf8').trim();
    expect(status).toBe('dead');
  });
});
