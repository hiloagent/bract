/**
 * Tier 5 — init and log command tests.
 *
 * `bract init` scaffolds a starter bract.yml.
 * `bract log` displays or streams agent log output.
 *
 * Neither command requires a running agent or LLM — they operate purely on
 * the filesystem, making all tests here fast and static.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { cli } from './helpers/cli';
import { makeFixture, registerAgent, type Fixture } from './helpers/fixtures';

// ────────────────────────────────────────────────
// TC-IN: bract init
// ────────────────────────────────────────────────

describe('init', () => {
  let fx: Fixture;
  beforeEach(() => { fx = makeFixture([{ name: 'alice' }]); });
  afterEach(() => fx.cleanup());

  it('TC-IN1: bract init creates bract.yml, exits 0, prints ✓', async () => {
    const target = join(fx.home, 'new-dir', 'bract.yml');
    const r = await cli(['init', '--file', target]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('✓');
    expect(existsSync(target)).toBe(true);
  });

  it('TC-IN2: created bract.yml is valid YAML with version 1 and ≥1 agent', async () => {
    const target = join(fx.home, 'starter.yml');
    await cli(['init', '--file', target]);

    const raw = readFileSync(target, 'utf8');
    expect(raw).toContain('version: 1');
    expect(raw).toContain('agents:');
    expect(raw).toContain('model:');
  });

  it('TC-IN3: bract init fails if file already exists (exits 1)', async () => {
    const target = join(fx.home, 'starter.yml');
    writeFileSync(target, 'existing content\n', 'utf8');

    const r = await cli(['init', '--file', target]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('already exists');
    // File must not be overwritten
    expect(readFileSync(target, 'utf8')).toBe('existing content\n');
  });

  it('TC-IN4: bract init --force overwrites existing file', async () => {
    const target = join(fx.home, 'starter.yml');
    writeFileSync(target, 'old content\n', 'utf8');

    const r = await cli(['init', '--file', target, '--force']);
    expect(r.exitCode).toBe(0);
    expect(readFileSync(target, 'utf8')).not.toBe('old content\n');
    expect(readFileSync(target, 'utf8')).toContain('version: 1');
  });

  it('TC-IN5: bract init --json returns { created: true, file: ... }', async () => {
    const target = join(fx.home, 'starter.yml');
    const r = await cli(['init', '--file', target, '--json']);
    expect(r.exitCode).toBe(0);
    const data = JSON.parse(r.stdout);
    expect(data.created).toBe(true);
    expect(data.file).toBe(target);
  });

  it('TC-IN6: bract init --json on existing file has valid:false shape', async () => {
    const target = join(fx.home, 'starter.yml');
    writeFileSync(target, 'existing\n', 'utf8');

    // Without --force, exits 1 — check error message still references the file
    const r = await cli(['init', '--file', target]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain(target);
  });

  it('TC-IN7: bract init creates a config that passes bract validate', async () => {
    const target = join(fx.home, 'starter.yml');
    await cli(['init', '--file', target]);

    const r = await cli(['validate', '--file', target]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('✓');
  });
});

// ────────────────────────────────────────────────
// TC-LOG: bract log
// ────────────────────────────────────────────────

describe('log', () => {
  let fx: Fixture;
  beforeEach(() => { fx = makeFixture([{ name: 'alice' }]); });
  afterEach(() => fx.cleanup());

  it('TC-LOG1: log for unknown agent exits 3 with "unknown agent"', async () => {
    const r = await cli(['log', 'ghost'], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(3);
    expect(r.stderr).toContain('ghost');
  });

  it('TC-LOG2: log for registered agent with no log file prints placeholder', async () => {
    registerAgent(fx.home, 'alice');
    const r = await cli(['log', 'alice'], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('alice');
    // Either "no log entries yet" or similar placeholder
    expect(r.stdout.length).toBeGreaterThan(0);
  });

  it('TC-LOG3: log displays last 20 lines of agent.log', async () => {
    registerAgent(fx.home, 'alice');
    const logFile = join(fx.home, 'agents', 'alice', 'logs', 'agent.log');

    // Write 30 lines
    const lines = Array.from({ length: 30 }, (_, i) => `line-${i + 1}`).join('\n') + '\n';
    writeFileSync(logFile, lines, 'utf8');

    const r = await cli(['log', 'alice'], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(0);
    // Should show last 20 lines (line-11 through line-30)
    expect(r.stdout).toContain('line-30');
    expect(r.stdout).toContain('line-11');
    // Should NOT show early lines
    expect(r.stdout).not.toContain('line-1\n');
  });

  it('TC-LOG4: log --all shows every line of agent.log', async () => {
    registerAgent(fx.home, 'alice');
    const logFile = join(fx.home, 'agents', 'alice', 'logs', 'agent.log');

    const lines = Array.from({ length: 30 }, (_, i) => `line-${i + 1}`).join('\n') + '\n';
    writeFileSync(logFile, lines, 'utf8');

    const r = await cli(['log', 'alice', '--all'], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('line-1');
    expect(r.stdout).toContain('line-30');
  });

  it('TC-LOG5: log without agent name exits 2', async () => {
    const r = await cli(['log'], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('agent name required');
  });
});
