/**
 * @file tests/e2e/tier3-supervisor.test.ts
 * Tier 3 — Supervisor (bract up/down), restart policies, pipe routing.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cli } from './helpers/cli.ts';
import { makeFixture, type Fixture } from './helpers/fixtures.ts';
import { startMockLLM, type MockLLMServer } from './helpers/mock-llm-server.ts';
import { trackSupervisorPid, trackAgentPid, killAll, isAlive, waitForFile } from './helpers/process-cleanup.ts';

let fx: Fixture;
let llm: MockLLMServer;

beforeEach(async () => {
  fx = makeFixture([{ name: 'assistant', model: 'mock-model', restart: 'on-failure' }]);
  llm = await startMockLLM();
  llm.setFixed('supervisor reply');
});

afterEach(() => {
  killAll();
  fx.cleanup();
  llm.stop();
});

describe('bract up / down', () => {
  test('TC-SV1: bract up --detach writes supervisor.pid', async () => {
    const r = await cli(
      ['up', '--file', fx.configPath],
      { env: { ...fx.env, BRACT_AGENT_BASE_URL: llm.baseUrl }, cwd: fx.home },
    );
    expect(r.exitCode).toBe(0);

    const pidFile = join(fx.home, 'supervisor.pid');
    const appeared = await waitForFile(pidFile, 5000);
    expect(appeared).toBe(true);

    const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
    trackSupervisorPid(fx.home);
    expect(isAlive(pid)).toBe(true);
  });

  test('TC-SV2: bract up spawns all agents from config', async () => {
    await cli(
      ['up', '--file', fx.configPath],
      { env: { ...fx.env, BRACT_AGENT_BASE_URL: llm.baseUrl }, cwd: fx.home },
    );
    trackSupervisorPid(fx.home);
    await Bun.sleep(1500);

    const r = await cli(['ps'], { env: fx.env });
    expect(r.stdout).toContain('assistant');
    trackAgentPid(fx.home, 'assistant');
  });

  test('TC-SV3: bract down stops supervisor', async () => {
    await cli(
      ['up', '--file', fx.configPath],
      { env: { ...fx.env, BRACT_AGENT_BASE_URL: llm.baseUrl }, cwd: fx.home },
    );
    const pidFile = join(fx.home, 'supervisor.pid');
    await waitForFile(pidFile, 5000);
    const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);

    const downResult = await cli(['down'], { env: fx.env });
    expect(downResult.exitCode).toBe(0);

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (!isAlive(pid)) break;
      await Bun.sleep(200);
    }
    expect(isAlive(pid)).toBe(false);
  });

  test('TC-SV4: bract down with no supervisor running exits gracefully', async () => {
    const r = await cli(['down'], { env: fx.env });
    // Should exit 0 or non-zero but not crash
    expect([0, 1]).toContain(r.exitCode);
  });
});

describe('supervisor restart', () => {
  test('TC-SV5: agent with restart:always gets restarted after kill', async () => {
    const fx2 = makeFixture([{ name: 'worker', model: 'mock-model', restart: 'always' }]);
    const llm2 = await startMockLLM();
    llm2.setFixed('restarted reply');

    await cli(
      ['up', '--file', fx2.configPath],
      { env: { ...fx2.env, BRACT_AGENT_BASE_URL: llm2.baseUrl }, cwd: fx2.home },
    );
    const svPidFile = join(fx2.home, 'supervisor.pid');
    await waitForFile(svPidFile, 5000);
    trackSupervisorPid(fx2.home);

    const agentPidFile = join(fx2.home, 'agents', 'worker', 'pid');
    await waitForFile(agentPidFile, 5000);
    const originalPid = parseInt(readFileSync(agentPidFile, 'utf8').trim(), 10);
    trackAgentPid(fx2.home, 'worker');

    // Kill the agent
    process.kill(originalPid, 'SIGKILL');
    await Bun.sleep(500);

    // Wait for new pid to appear
    const deadline = Date.now() + 15000;
    let newPid = originalPid;
    while (Date.now() < deadline) {
      if (existsSync(agentPidFile)) {
        newPid = parseInt(readFileSync(agentPidFile, 'utf8').trim(), 10);
        if (newPid !== originalPid && isAlive(newPid)) break;
      }
      await Bun.sleep(300);
    }
    trackAgentPid(fx2.home, 'worker');
    expect(newPid).not.toBe(originalPid);
    expect(isAlive(newPid)).toBe(true);

    fx2.cleanup();
    llm2.stop();
  }, 25000);

  test('TC-SV6: agent with restart:never is not restarted', async () => {
    const fx3 = makeFixture([{ name: 'oneshot', model: 'mock-model', restart: 'never' }]);
    const llm3 = await startMockLLM();

    await cli(
      ['up', '--file', fx3.configPath],
      { env: { ...fx3.env, BRACT_AGENT_BASE_URL: llm3.baseUrl }, cwd: fx3.home },
    );
    const svPidFile = join(fx3.home, 'supervisor.pid');
    await waitForFile(svPidFile, 5000);
    trackSupervisorPid(fx3.home);

    const agentPidFile = join(fx3.home, 'agents', 'oneshot', 'pid');
    await waitForFile(agentPidFile, 5000);
    const originalPid = parseInt(readFileSync(agentPidFile, 'utf8').trim(), 10);
    process.kill(originalPid, 'SIGKILL');
    await Bun.sleep(6000); // wait longer than heartbeat interval

    const newPid = existsSync(agentPidFile)
      ? parseInt(readFileSync(agentPidFile, 'utf8').trim(), 10)
      : originalPid;
    // If pid changed and is alive, the agent was restarted (unexpected)
    const wasRestarted = newPid !== originalPid && isAlive(newPid);
    expect(wasRestarted).toBe(false);

    fx3.cleanup();
    llm3.stop();
  }, 15000);
});
