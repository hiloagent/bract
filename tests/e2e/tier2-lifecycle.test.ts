/**
 * Tier 2 — Agent spawn lifecycle tests.
 * Tests bract spawn in detached and foreground modes, signal handling, and
 * message processing with a mock LLM.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { cli } from './helpers/cli';
import { makeFixture, type Fixture } from './helpers/fixtures';
import { startMockLLM, type MockLLMServer } from './helpers/mock-llm-server';
import {
  trackPidFile, killAll, isAlive, waitForFile, waitForFileContent,
} from './helpers/process-cleanup';

describe('spawn lifecycle', () => {
  let fx: Fixture;
  let llm: MockLLMServer;

  beforeEach(() => {
    fx = makeFixture([{ name: 'alice', model: 'test-model' }]);
    llm = startMockLLM();
    llm.setFixed('mock response');
  });

  afterEach(() => {
    killAll();
    llm.stop();
    fx.cleanup();
  });

  // ────────────────────────────────────────────────
  // TC-L1–L3: detached spawn
  // ────────────────────────────────────────────────

  it('TC-L1: spawn --detach exits 0, writes pid file', async () => {
    const r = await cli(
      ['spawn', 'alice', '--detach', '--file', fx.configPath],
      { env: { BRACT_HOME: fx.home, BRACT_AGENT_BASE_URL: llm.baseUrl } },
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('spawned');
    expect(r.stdout).toContain('alice');

    const pidFile = join(fx.home, 'agents', 'alice', 'pid');
    const appeared = await waitForFile(pidFile, 3_000);
    expect(appeared).toBe(true);

    const pid = trackPidFile(pidFile);
    expect(pid).toBeGreaterThan(0);
    expect(isAlive(pid!)).toBe(true);
  });

  it('TC-L2: spawn --detach --json returns JSON with pid', async () => {
    const r = await cli(
      ['spawn', 'alice', '--detach', '--json', '--file', fx.configPath],
      { env: { BRACT_HOME: fx.home, BRACT_AGENT_BASE_URL: llm.baseUrl } },
    );
    expect(r.exitCode).toBe(0);
    const data = JSON.parse(r.stdout);
    expect(data.name).toBe('alice');
    expect(data.pid).toBeGreaterThan(0);
    expect(data.status).toBe('running');
  });

  it('TC-L3: spawned agent status is "running" in ps', async () => {
    await cli(
      ['spawn', 'alice', '--detach', '--file', fx.configPath],
      { env: { BRACT_HOME: fx.home, BRACT_AGENT_BASE_URL: llm.baseUrl } },
    );
    const pidFile = join(fx.home, 'agents', 'alice', 'pid');
    await waitForFile(pidFile, 3_000);
    trackPidFile(pidFile);

    const ps = await cli(['ps', '--json'], { env: { BRACT_HOME: fx.home } });
    const agents = JSON.parse(ps.stdout);
    const alice = agents.find((a: { name: string }) => a.name === 'alice');
    expect(alice?.status).toBe('running');
  });

  // ────────────────────────────────────────────────
  // TC-L4: spawn unknown agent
  // ────────────────────────────────────────────────

  it('TC-L4: spawn unknown agent exits 1', async () => {
    const r = await cli(
      ['spawn', 'ghost', '--detach', '--file', fx.configPath],
      { env: { BRACT_HOME: fx.home } },
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('ghost');
  });

  // ────────────────────────────────────────────────
  // TC-L5–L6: message processing
  // ────────────────────────────────────────────────

  it('TC-L5: agent processes inbox message and writes outbox', async () => {
    llm.enqueue({ content: 'pong!' });

    await cli(
      ['spawn', 'alice', '--detach', '--file', fx.configPath],
      { env: { BRACT_HOME: fx.home, BRACT_AGENT_BASE_URL: llm.baseUrl } },
    );
    const pidFile = join(fx.home, 'agents', 'alice', 'pid');
    await waitForFile(pidFile, 3_000);
    trackPidFile(pidFile);

    // Send a message
    await cli(['send', 'alice', 'ping'], { env: { BRACT_HOME: fx.home } });

    // Wait for outbox to have a file
    const outboxDir = join(fx.home, 'agents', 'alice', 'outbox');
    const appeared = await waitForFile(outboxDir, 8_000);
    // The outbox dir exists as soon as register() runs, but we need a .msg file
    const msgAppeared = await (async () => {
      const deadline = Date.now() + 8_000;
      while (Date.now() < deadline) {
        const { readdirSync } = await import('node:fs');
        try {
          const files = readdirSync(outboxDir).filter((f: string) => f.endsWith('.msg'));
          if (files.length > 0) return true;
        } catch { /* ignore */ }
        await Bun.sleep(200);
      }
      return false;
    })();
    expect(msgAppeared).toBe(true);

    const read = await cli(['read', 'alice'], { env: { BRACT_HOME: fx.home } });
    expect(read.stdout).toContain('pong!');
  }, 20_000);

  // ────────────────────────────────────────────────
  // TC-L6–L9: signal handling
  // ────────────────────────────────────────────────

  it('TC-L6: SIGTERM causes agent to set status=dead', async () => {
    await cli(
      ['spawn', 'alice', '--detach', '--file', fx.configPath],
      { env: { BRACT_HOME: fx.home, BRACT_AGENT_BASE_URL: llm.baseUrl } },
    );
    const pidFile = join(fx.home, 'agents', 'alice', 'pid');
    await waitForFile(pidFile, 3_000);

    const pid = trackPidFile(pidFile);
    expect(pid).toBeGreaterThan(0);

    // Give the worker time to register its SIGTERM handler
    await Bun.sleep(500);

    process.kill(pid!, 'SIGTERM');

    const died = await waitForFileContent(
      join(fx.home, 'agents', 'alice', 'status'),
      'dead',
      5_000,
    );
    expect(died).toBe(true);
  }, 15_000);

  it('TC-L7: after SIGTERM, ps shows status=dead', async () => {
    await cli(
      ['spawn', 'alice', '--detach', '--file', fx.configPath],
      { env: { BRACT_HOME: fx.home, BRACT_AGENT_BASE_URL: llm.baseUrl } },
    );
    const pidFile = join(fx.home, 'agents', 'alice', 'pid');
    await waitForFile(pidFile, 3_000);

    const pid = trackPidFile(pidFile);
    await Bun.sleep(500);
    process.kill(pid!, 'SIGTERM');
    await waitForFileContent(join(fx.home, 'agents', 'alice', 'status'), 'dead', 5_000);

    const ps = await cli(['ps', '--json'], { env: { BRACT_HOME: fx.home } });
    const agents = JSON.parse(ps.stdout);
    const alice = agents.find((a: { name: string }) => a.name === 'alice');
    expect(alice?.status).toBe('dead');
  }, 15_000);

  it('TC-L8: spawn missing --name and no --all exits 1', async () => {
    const r = await cli(
      ['spawn', '--detach', '--file', fx.configPath],
      { env: { BRACT_HOME: fx.home } },
    );
    expect(r.exitCode).toBe(1);
  });

  it('TC-L9: spawn --all --detach spawns multiple agents', async () => {
    const fx2 = makeFixture([
      { name: 'alice', model: 'test' },
      { name: 'bob', model: 'test' },
    ]);
    try {
      const r = await cli(
        ['spawn', '--all', '--detach', '--file', fx2.configPath],
        { env: { BRACT_HOME: fx2.home, BRACT_AGENT_BASE_URL: llm.baseUrl } },
      );
      expect(r.exitCode).toBe(0);

      // Both agents should appear in ps
      const alicePid = await waitForFile(join(fx2.home, 'agents', 'alice', 'pid'), 3_000);
      const bobPid = await waitForFile(join(fx2.home, 'agents', 'bob', 'pid'), 3_000);
      expect(alicePid).toBe(true);
      expect(bobPid).toBe(true);

      trackPidFile(join(fx2.home, 'agents', 'alice', 'pid'));
      trackPidFile(join(fx2.home, 'agents', 'bob', 'pid'));

      const ps = await cli(['ps', '--json'], { env: { BRACT_HOME: fx2.home } });
      const agents = JSON.parse(ps.stdout);
      expect(agents.length).toBe(2);
    } finally {
      fx2.cleanup();
    }
  }, 15_000);
});
