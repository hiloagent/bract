import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProcessTable } from '@losoft/bract-runtime';
import { Supervisor } from './supervisor.js';

function tmpHome() {
  return mkdtempSync(join(tmpdir(), 'bract-sup-test-'));
}

describe('Supervisor', () => {
  it('writes supervisor.pid on start()', () => {
    const home = tmpHome();
    const sup = new Supervisor(home);
    sup.start();
    const pid = parseInt(readFileSync(join(home, 'supervisor.pid'), 'utf8').trim(), 10);
    expect(pid).toBe(process.pid);
    sup.stop();
  });

  it('start() is idempotent — second call is a no-op', () => {
    const home = tmpHome();
    const sup = new Supervisor(home);
    sup.start();
    expect(sup.running).toBe(true);
    sup.start(); // should not throw or create a second timer
    expect(sup.running).toBe(true);
    sup.stop();
  });

  it('stop() clears running flag', () => {
    const home = tmpHome();
    const sup = new Supervisor(home);
    sup.start();
    sup.stop();
    expect(sup.running).toBe(false);
  });

  it('throws on duplicate register()', () => {
    const home = tmpHome();
    const sup = new Supervisor(home);
    sup.register({ name: 'a', spawn: () => 1 });
    expect(() => sup.register({ name: 'a', spawn: () => 1 })).toThrow(/already registered/);
  });

  it('unregister() is safe when agent is not registered', () => {
    const home = tmpHome();
    const sup = new Supervisor(home);
    expect(() => sup.unregister('ghost')).not.toThrow();
  });

  it('emits agent:died and restarts when pid is dead', async () => {
    const home = tmpHome();
    const table = new ProcessTable(home);
    table.register('bot', 'test-model');
    // Use PID 1 — guaranteed to exist on any Linux system, so we use a fake impossible PID
    // Instead, register with a real PID and then kill the process — not safe in tests.
    // We test via heartbeat() by setting status=running with a dead PID.
    table.setRunning('bot', 99_999_999); // PID that almost certainly does not exist

    const sup = new Supervisor(home, {
      baseDelayMs: 50,
      maxBackoffMs: 200,
      maxRestarts: 3,
      resetWindowMs: 60_000,
    });

    const newPid = 42;
    sup.register({
      name: 'bot',
      restart: 'always',
      spawn: () => newPid,
    });

    const died: Array<{ name: string; pid: number }> = [];
    const restarted: Array<{ name: string; newPid: number }> = [];

    sup.on('agent:died', (e) => died.push(e));
    sup.on('agent:restarted', (e) => restarted.push(e));

    await sup.heartbeat();

    expect(died).toHaveLength(1);
    expect(died[0]?.name).toBe('bot');

    // Wait for restart to fire (delay is baseDelayMs=50 + up to 500ms jitter)
    await new Promise((r) => setTimeout(r, 700));

    expect(restarted).toHaveLength(1);
    expect(restarted[0]?.newPid).toBe(newPid);

    // Crash record should exist
    const crashDir = join(home, 'agents', 'bot', 'crashes');
    const files = readdirSync(crashDir);
    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  it('respects restart: never', async () => {
    const home = tmpHome();
    const table = new ProcessTable(home);
    table.register('one-shot', 'test-model');
    table.setRunning('one-shot', 99_999_998);

    const sup = new Supervisor(home, { baseDelayMs: 50 });
    let spawnCount = 0;
    sup.register({
      name: 'one-shot',
      restart: 'never',
      spawn: () => { spawnCount++; return 99; },
    });

    await sup.heartbeat();
    await new Promise((r) => setTimeout(r, 200));
    expect(spawnCount).toBe(0);
  });

  it('emits agent:exhausted after maxRestarts crashes', async () => {
    const home = tmpHome();
    const table = new ProcessTable(home);

    const sup = new Supervisor(home, {
      baseDelayMs: 10,
      maxBackoffMs: 20,
      maxRestarts: 2,
      resetWindowMs: 60_000,
    });

    // Pre-fill restart history with 2 entries (at the limit)
    const state = (sup as unknown as { agents: Map<string, { restartHistory: number[] }> }).agents;

    table.register('crashy', 'test-model');
    table.setRunning('crashy', 99_999_997);

    sup.register({ name: 'crashy', restart: 'always', spawn: () => 1 });

    // Manually inject history so the next crash triggers exhaustion
    const s = state.get('crashy')!;
    s.restartHistory = [Date.now(), Date.now()];

    const exhausted: string[] = [];
    sup.on('agent:exhausted', ({ name }) => exhausted.push(name));

    await sup.heartbeat();
    expect(exhausted).toContain('crashy');
  });
});
