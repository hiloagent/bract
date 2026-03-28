/**
 * Tier 3 — Supervisor tests (bract up / bract down, restart policy).
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { cli } from './helpers/cli';
import { makeFixture, type Fixture } from './helpers/fixtures';
import { startMockLLM, type MockLLMServer } from './helpers/mock-llm-server';
import {
  trackPid, trackPidFile, killAll, isAlive,
  waitForFile, waitForFileContent,
} from './helpers/process-cleanup';

describe('supervisor', () => {
  let fx: Fixture;
  let llm: MockLLMServer;

  beforeEach(() => {
    fx = makeFixture([{ name: 'alice', model: 'test-model' }]);
    llm = startMockLLM();
    llm.setFixed('mock response');
  });

  afterEach(async () => {
    // Give processes a moment to clean up
    await Bun.sleep(100);
    killAll();
    llm.stop();
    fx.cleanup();
  });

  // ────────────────────────────────────────────────
  // TC-SV1–SV2: bract up
  // ────────────────────────────────────────────────

  it('TC-SV1: bract up starts supervisor and writes supervisor.pid', async () => {
    const r = await cli(
      ['up', '--file', fx.configPath],
      { env: { BRACT_HOME: fx.home, BRACT_AGENT_BASE_URL: llm.baseUrl } },
    );
    expect(r.exitCode).toBe(0);

    const pidFile = join(fx.home, 'supervisor.pid');
    const appeared = await waitForFile(pidFile, 5_000);
    expect(appeared).toBe(true);

    const pid = trackPidFile(pidFile);
    expect(pid).toBeGreaterThan(0);
    expect(isAlive(pid!)).toBe(true);

    // Track agent PID for cleanup
    const alicePidFile = join(fx.home, 'agents', 'alice', 'pid');
    const agentStarted = await waitForFile(alicePidFile, 8_000);
    if (agentStarted) trackPidFile(alicePidFile);
  }, 15_000);

  it('TC-SV2: bract up starts all agents in the fleet', async () => {
    const fx2 = makeFixture([
      { name: 'alice', model: 'test' },
      { name: 'bob', model: 'test' },
    ]);
    try {
      await cli(
        ['up', '--file', fx2.configPath],
        { env: { BRACT_HOME: fx2.home, BRACT_AGENT_BASE_URL: llm.baseUrl } },
      );

      const svPid = await waitForFile(join(fx2.home, 'supervisor.pid'), 5_000);
      expect(svPid).toBe(true);
      trackPidFile(join(fx2.home, 'supervisor.pid'));

      // Both agents should be running
      const aliceRunning = await waitForFileContent(
        join(fx2.home, 'agents', 'alice', 'status'), 'running', 8_000,
      );
      const bobRunning = await waitForFileContent(
        join(fx2.home, 'agents', 'bob', 'status'), 'running', 8_000,
      );
      expect(aliceRunning).toBe(true);
      expect(bobRunning).toBe(true);

      trackPidFile(join(fx2.home, 'agents', 'alice', 'pid'));
      trackPidFile(join(fx2.home, 'agents', 'bob', 'pid'));
    } finally {
      fx2.cleanup();
    }
  }, 20_000);

  it('TC-SV3: bract up when already running prints "already running"', async () => {
    await cli(
      ['up', '--file', fx.configPath],
      { env: { BRACT_HOME: fx.home, BRACT_AGENT_BASE_URL: llm.baseUrl } },
    );
    await waitForFile(join(fx.home, 'supervisor.pid'), 5_000);
    trackPidFile(join(fx.home, 'supervisor.pid'));

    const r2 = await cli(
      ['up', '--file', fx.configPath],
      { env: { BRACT_HOME: fx.home } },
    );
    expect(r2.exitCode).toBe(0);
    expect(r2.stdout).toContain('already running');
  }, 15_000);

  // ────────────────────────────────────────────────
  // TC-SV4: bract down
  // ────────────────────────────────────────────────

  it('TC-SV4: bract down stops the supervisor', async () => {
    await cli(
      ['up', '--file', fx.configPath],
      { env: { BRACT_HOME: fx.home, BRACT_AGENT_BASE_URL: llm.baseUrl } },
    );
    const svPidFile = join(fx.home, 'supervisor.pid');
    await waitForFile(svPidFile, 5_000);
    const svPid = trackPidFile(svPidFile);
    expect(svPid).toBeGreaterThan(0);

    const down = await cli(['down'], { env: { BRACT_HOME: fx.home } });
    expect(down.exitCode).toBe(0);
    expect(down.stdout).toContain('stopped');

    // supervisor.pid should be removed
    const pidGone = await (async () => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        if (!existsSync(svPidFile)) return true;
        await Bun.sleep(200);
      }
      return false;
    })();
    expect(pidGone).toBe(true);
    expect(isAlive(svPid!)).toBe(false);
  }, 20_000);

  it('TC-SV4b: bract down when not running exits 0', async () => {
    const r = await cli(['down'], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('no supervisor');
  });

  // ────────────────────────────────────────────────
  // TC-SV5: restart policy
  // ────────────────────────────────────────────────

  it('TC-SV5: agent with restart:always gets restarted after SIGKILL', async () => {
    const fxRestart = makeFixture([{ name: 'alice', model: 'test-model', restart: 'always' }]);
    try {
      await cli(
        ['up', '--file', fxRestart.configPath],
        { env: { BRACT_HOME: fxRestart.home, BRACT_AGENT_BASE_URL: llm.baseUrl } },
      );

      const svPidFile = join(fxRestart.home, 'supervisor.pid');
      const svReady = await waitForFile(svPidFile, 5_000);
      expect(svReady).toBe(true);
      const svPid = trackPidFile(svPidFile);

      // Wait for agent to be running
      const agentStatusFile = join(fxRestart.home, 'agents', 'alice', 'status');
      const agentRunning = await waitForFileContent(agentStatusFile, 'running', 8_000);
      expect(agentRunning).toBe(true);

      // Read initial PID
      const agentPidFile = join(fxRestart.home, 'agents', 'alice', 'pid');
      const initialPid = parseInt(readFileSync(agentPidFile, 'utf8').trim(), 10);
      expect(initialPid).toBeGreaterThan(0);
      expect(isAlive(initialPid)).toBe(true);

      // SIGKILL the agent — bypasses SIGTERM handler
      process.kill(initialPid, 'SIGKILL');

      // Wait for process to die
      const deadline = Date.now() + 2_000;
      while (Date.now() < deadline && isAlive(initialPid)) {
        await Bun.sleep(100);
      }
      expect(isAlive(initialPid)).toBe(false);

      // Supervisor heartbeat fires every 5s; restart delay is 1s.
      // Give up to 15s for the agent to be restarted with a new PID.
      const restarted = await (async () => {
        const deadline2 = Date.now() + 15_000;
        while (Date.now() < deadline2) {
          if (existsSync(agentPidFile)) {
            const newPidStr = readFileSync(agentPidFile, 'utf8').trim();
            const newPid = parseInt(newPidStr, 10);
            if (!isNaN(newPid) && newPid > 0 && newPid !== initialPid && isAlive(newPid)) {
              trackPid(newPid);
              return true;
            }
          }
          await Bun.sleep(300);
        }
        return false;
      })();

      expect(restarted).toBe(true);
    } finally {
      fxRestart.cleanup();
    }
  }, 35_000);

  it('TC-SV6: bract up --json returns started:true with agent names', async () => {
    const r = await cli(
      ['up', '--file', fx.configPath, '--json'],
      { env: { BRACT_HOME: fx.home, BRACT_AGENT_BASE_URL: llm.baseUrl } },
    );
    expect(r.exitCode).toBe(0);
    const data = JSON.parse(r.stdout);
    expect(data.started).toBe(true);
    expect(data.pid).toBeGreaterThan(0);
    expect(data.agents).toContain('alice');
    trackPidFile(join(fx.home, 'supervisor.pid'));

    // Track agent PID for cleanup
    const alicePidFile = join(fx.home, 'agents', 'alice', 'pid');
    const agentStarted = await waitForFile(alicePidFile, 8_000);
    if (agentStarted) trackPidFile(alicePidFile);
  }, 15_000);
});
