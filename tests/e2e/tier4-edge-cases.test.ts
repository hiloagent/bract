/**
 * Tier 4 — Edge case tests.
 * Tests error paths, missing files, invalid inputs, and flag combinations.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { join } from 'node:path';
import { cli } from './helpers/cli';
import { makeFixture, registerAgent, type Fixture } from './helpers/fixtures';
import { killAll, trackPidFile, waitForFile } from './helpers/process-cleanup';
import { startMockLLM, type MockLLMServer } from './helpers/mock-llm-server';

describe('edge cases', () => {
  const fixtures: Fixture[] = [];
  const llms: MockLLMServer[] = [];

  afterEach(() => {
    killAll();
    for (const l of llms) l.stop();
    for (const fx of fixtures) fx.cleanup();
    fixtures.length = 0;
    llms.length = 0;
  });

  function fx(agents: Parameters<typeof makeFixture>[0]): Fixture {
    const f = makeFixture(agents);
    fixtures.push(f);
    return f;
  }

  // ────────────────────────────────────────────────
  // TC-E1–E4: BRACT_HOME handling
  // ────────────────────────────────────────────────

  it('TC-E1: BRACT_HOME env var is respected', async () => {
    const f = fx([{ name: 'alice' }]);
    registerAgent(f.home, 'alice');
    const r = await cli(['ps'], { env: { BRACT_HOME: f.home } });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('alice');
  });

  it('TC-E2: --home flag takes precedence over BRACT_HOME env', async () => {
    const f1 = fx([{ name: 'alice' }]);
    const f2 = fx([{ name: 'bob' }]);
    registerAgent(f1.home, 'alice');
    registerAgent(f2.home, 'bob');

    // f2 home in env, but f1 home via --home flag
    const r = await cli(['--home', f1.home, 'ps'], { env: { BRACT_HOME: f2.home } });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('alice');
    expect(r.stdout).not.toContain('bob');
  });

  it('TC-E3: multiple agents registered show in ps', async () => {
    const f = fx([{ name: 'alice' }, { name: 'bob' }]);
    registerAgent(f.home, 'alice');
    registerAgent(f.home, 'bob');

    const r = await cli(['ps'], { env: { BRACT_HOME: f.home } });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('alice');
    expect(r.stdout).toContain('bob');
  });

  it('TC-E4: spawn requires config file — exits 1 when missing', async () => {
    const r = await cli(
      ['spawn', 'alice', '--detach', '--file', '/nonexistent/bract.yml'],
      { env: { BRACT_HOME: '/tmp/e2e-fake-home' } },
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('cannot read file');
  });

  // ────────────────────────────────────────────────
  // TC-E5–E6: send edge cases
  // ────────────────────────────────────────────────

  it('TC-E5: send empty stdin body exits 2', async () => {
    const f = fx([{ name: 'alice' }]);
    registerAgent(f.home, 'alice');

    const r = await cli(['send', 'alice', '-'], {
      env: { BRACT_HOME: f.home },
      stdin: '   ',  // whitespace only — trims to empty
    });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('empty stdin');
  });

  it('TC-E6: send without agent name exits 2', async () => {
    const f = fx([{ name: 'alice' }]);
    const r = await cli(['send'], { env: { BRACT_HOME: f.home } });
    expect(r.exitCode).toBe(2);
  });

  // ────────────────────────────────────────────────
  // TC-E7–E8: inbox/read for unregistered agent
  // ────────────────────────────────────────────────

  it('TC-E7: inbox for unregistered agent exits 3', async () => {
    const f = fx([{ name: 'alice' }]);
    const r = await cli(['inbox', 'ghost'], { env: { BRACT_HOME: f.home } });
    expect(r.exitCode).toBe(3);
    expect(r.stderr).toContain('ghost');
  });

  it('TC-E8: read for unregistered agent exits 3', async () => {
    const f = fx([{ name: 'alice' }]);
    const r = await cli(['read', 'ghost'], { env: { BRACT_HOME: f.home } });
    expect(r.exitCode).toBe(3);
    expect(r.stderr).toContain('ghost');
  });

  // ────────────────────────────────────────────────
  // TC-E9–E10: validate edge cases
  // ────────────────────────────────────────────────

  it('TC-E9: validate invalid restart value exits 1', async () => {
    const f = fx([{ name: 'alice' }]);
    const { writeFileSync } = await import('node:fs');
    const bad = join(f.home, 'bad.yml');
    writeFileSync(bad, 'version: 1\nagents:\n  - name: alice\n    model: test\n    restart: sometimes\n', 'utf8');

    const r = await cli(['validate', '--file', bad], { env: { BRACT_HOME: f.home } });
    expect(r.exitCode).toBe(1);
    expect(r.stdout + r.stderr).toContain('restart');
  });

  it('TC-E10: validate unknown top-level key exits 1', async () => {
    const f = fx([{ name: 'alice' }]);
    const { writeFileSync } = await import('node:fs');
    const bad = join(f.home, 'bad.yml');
    writeFileSync(bad, 'version: 1\nextra_key: oops\nagents:\n  - name: alice\n    model: test\n', 'utf8');

    const r = await cli(['validate', '--file', bad], { env: { BRACT_HOME: f.home } });
    expect(r.exitCode).toBe(1);
    expect(r.stdout + r.stderr).toContain('extra_key');
  });
});
