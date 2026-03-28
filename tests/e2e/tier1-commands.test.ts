/**
 * @file tests/e2e/tier1-commands.test.ts
 * Tier 1 — Core CLI commands that don't require a running agent or LLM.
 * Tests: ps, send, inbox, read, validate, log — exit codes, stdout, filesystem state.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cli } from './helpers/cli.ts';
import { makeFixture, registerAgent, type Fixture } from './helpers/fixtures.ts';

// ── validate ──────────────────────────────────────────────────────────────────

describe('bract validate', () => {
  let fx: Fixture;
  beforeEach(() => { fx = makeFixture(); });
  afterEach(() => fx.cleanup());

  test('TC-V1: valid minimal config exits 0', async () => {
    const r = await cli(['validate', '--file', fx.configPath]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('valid');
  });

  test('TC-V2: valid config with pipes exits 0', async () => {
    const fx2 = makeFixture(
      [{ name: 'a', model: 'm' }, { name: 'b', model: 'm' }],
      [{ from: 'a', to: 'b' }],
    );
    const r = await cli(['validate', '--file', fx2.configPath]);
    expect(r.exitCode).toBe(0);
    fx2.cleanup();
  });

  test('TC-V3: missing file exits non-zero', async () => {
    const r = await cli(['validate', '--file', '/nonexistent/bract.yml']);
    expect(r.exitCode).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/cannot read|no such file|ENOENT/i);
  });

  test('TC-V4: bad YAML exits non-zero', async () => {
    const bad = join(fx.home, 'bad.yml');
    writeFileSync(bad, 'version: 1\nagents: not-a-list\n');
    const r = await cli(['validate', '--file', bad]);
    expect(r.exitCode).not.toBe(0);
  });

  test('TC-V5: --json flag outputs JSON', async () => {
    const r = await cli(['validate', '--file', fx.configPath, '--json']);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.valid).toBe(true);
    expect(typeof parsed.agentCount).toBe('number');
  });

  test('TC-V6: --json flag before subcommand also works', async () => {
    const r = await cli(['--json', 'validate', '--file', fx.configPath]);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.valid).toBe(true);
  });

  test('TC-V7: missing agents array exits non-zero', async () => {
    const bad = join(fx.home, 'noagents.yml');
    writeFileSync(bad, 'version: 1\n');
    const r = await cli(['validate', '--file', bad]);
    expect(r.exitCode).not.toBe(0);
  });

  test('TC-V8: agent missing name exits non-zero', async () => {
    const bad = join(fx.home, 'noname.yml');
    writeFileSync(bad, 'version: 1\nagents:\n  - model: llama3\n');
    const r = await cli(['validate', '--file', bad]);
    expect(r.exitCode).not.toBe(0);
  });

  test('TC-V9: agent missing model exits non-zero', async () => {
    const bad = join(fx.home, 'nomodel.yml');
    writeFileSync(bad, 'version: 1\nagents:\n  - name: assistant\n');
    const r = await cli(['validate', '--file', bad]);
    expect(r.exitCode).not.toBe(0);
  });

  test('TC-V10: wrong version exits non-zero', async () => {
    const bad = join(fx.home, 'v2.yml');
    writeFileSync(bad, 'version: 2\nagents:\n  - name: a\n    model: m\n');
    const r = await cli(['validate', '--file', bad]);
    expect(r.exitCode).not.toBe(0);
  });
});

// ── ps ────────────────────────────────────────────────────────────────────────

describe('bract ps', () => {
  let fx: Fixture;
  beforeEach(() => { fx = makeFixture(); });
  afterEach(() => fx.cleanup());

  test('TC-P1: empty home shows no agents', async () => {
    const r = await cli(['ps'], { env: fx.env });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/no agents/i);
  });

  test('TC-P2: --json flag returns empty array when no agents', async () => {
    const r = await cli(['ps', '--json'], { env: fx.env });
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(0);
  });

  test('TC-P3: registered agent appears in ps output', async () => {
    // Register an agent manually via filesystem
    const agentDir = join(fx.home, 'agents', 'mybot');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'status'), 'idle\n');
    writeFileSync(join(agentDir, 'model'), 'gpt-4o\n');

    const r = await cli(['ps'], { env: fx.env });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('mybot');
    expect(r.stdout).toContain('gpt-4o');
  });

  test('TC-P4: --json shows agent fields', async () => {
    const agentDir = join(fx.home, 'agents', 'worker');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'status'), 'running\n');
    writeFileSync(join(agentDir, 'model'), 'llama3\n');
    writeFileSync(join(agentDir, 'pid'), '12345\n');

    const r = await cli(['ps', '--json'], { env: fx.env });
    expect(r.exitCode).toBe(0);
    const agents = JSON.parse(r.stdout);
    expect(agents[0].name).toBe('worker');
    expect(agents[0].status).toBe('running');
    expect(agents[0].model).toBe('llama3');
  });
});

// ── send / inbox ──────────────────────────────────────────────────────────────

describe('bract send + inbox', () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = makeFixture();
    registerAgent(fx.home, 'assistant');
  });
  afterEach(() => fx.cleanup());

  test('TC-S1: send creates inbox message', async () => {
    const r = await cli(['send', 'assistant', 'hello world'], { env: fx.env });
    expect(r.exitCode).toBe(0);
    const inboxDir = join(fx.home, 'agents', 'assistant', 'inbox');
    const files = require('node:fs').readdirSync(inboxDir);
    expect(files.length).toBe(1);
  });

  test('TC-S2: inbox shows pending message', async () => {
    await cli(['send', 'assistant', 'test message'], { env: fx.env });
    const r = await cli(['inbox', 'assistant'], { env: fx.env });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('test message');
  });

  test('TC-S3: inbox --json returns message array', async () => {
    await cli(['send', 'assistant', 'json test'], { env: fx.env });
    const r = await cli(['inbox', 'assistant', '--json'], { env: fx.env });
    expect(r.exitCode).toBe(0);
    const msgs = JSON.parse(r.stdout);
    expect(Array.isArray(msgs)).toBe(true);
    expect(msgs[0].body).toBe('json test');
  });

  test('TC-S4: send from stdin', async () => {
    const r = await cli(['send', 'assistant', '-'], {
      env: fx.env,
      stdin: 'hello from stdin',
    });
    expect(r.exitCode).toBe(0);
    const ir = await cli(['inbox', 'assistant'], { env: fx.env });
    expect(ir.stdout).toContain('hello from stdin');
  });

  test('TC-S5: send missing agent name exits 2', async () => {
    const r = await cli(['send'], { env: fx.env });
    expect(r.exitCode).toBe(2);
  });

  test('TC-S6: multiple sends accumulate in inbox', async () => {
    await cli(['send', 'assistant', 'first'], { env: fx.env });
    await cli(['send', 'assistant', 'second'], { env: fx.env });
    const r = await cli(['inbox', 'assistant', '--all'], { env: fx.env });
    expect(r.stdout).toContain('first');
    expect(r.stdout).toContain('second');
  });

  test('TC-S7: --from flag sets message sender', async () => {
    await cli(['send', 'assistant', '--from', 'user1', 'hi'], { env: fx.env });
    const r = await cli(['inbox', 'assistant', '--json'], { env: fx.env });
    const msgs = JSON.parse(r.stdout);
    expect(msgs[0].from).toBe('user1');
  });
});

// ── read ──────────────────────────────────────────────────────────────────────

describe('bract read', () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = makeFixture();
    registerAgent(fx.home, 'assistant');
  });
  afterEach(() => fx.cleanup());

  test('TC-R1: empty outbox shows empty', async () => {
    const r = await cli(['read', 'assistant'], { env: fx.env });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/empty|no messages/i);
  });

  test('TC-R2: read shows manually written outbox message', async () => {
    const outboxDir = join(fx.home, 'agents', 'assistant', 'outbox');
    mkdirSync(outboxDir, { recursive: true });
    const msg = JSON.stringify({ v: 1, id: 'test-1', from: 'assistant', body: 'hello reply', ts: Date.now() });
    writeFileSync(join(outboxDir, '001-test-1.msg'), msg);

    const r = await cli(['read', 'assistant'], { env: fx.env });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('hello reply');
  });

  test('TC-R3: read missing agent name exits 2', async () => {
    const r = await cli(['read'], { env: fx.env });
    expect(r.exitCode).toBe(2);
  });

  test('TC-R4: read --json outputs message objects', async () => {
    const outboxDir = join(fx.home, 'agents', 'assistant', 'outbox');
    mkdirSync(outboxDir, { recursive: true });
    const msg = JSON.stringify({ v: 1, id: 'test-2', from: 'assistant', body: 'json reply', ts: Date.now() });
    writeFileSync(join(outboxDir, '001-test-2.msg'), msg);

    const r = await cli(['read', 'assistant', '--json'], { env: fx.env });
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(Array.isArray(parsed) ? parsed[0].body : parsed.body).toBe('json reply');
  });
});

// ── global flags ──────────────────────────────────────────────────────────────

describe('global flags', () => {
  let fx: Fixture;
  beforeEach(() => { fx = makeFixture(); });
  afterEach(() => fx.cleanup());

  test('TC-F1: --help shows usage', async () => {
    const r = await cli(['--help']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Usage');
  });

  test('TC-F2: unknown command exits 2', async () => {
    const r = await cli(['doesnotexist'], { env: fx.env });
    expect(r.exitCode).toBe(2);
  });

  test('TC-F3: --home flag overrides BRACT_HOME', async () => {
    const r = await cli(['--home', fx.home, 'ps']);
    expect(r.exitCode).toBe(0);
  });

  test('TC-F4: no args shows usage', async () => {
    const r = await cli([]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Usage');
  });
});
