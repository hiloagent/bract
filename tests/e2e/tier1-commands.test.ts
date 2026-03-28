/**
 * Tier 1 — Static command tests.
 * These tests do NOT spawn agent processes or require a running LLM.
 * They verify: validate, ps, send/inbox/read, global flags.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { cli } from './helpers/cli';
import { makeFixture, registerAgent, writeInboxMessage, type Fixture } from './helpers/fixtures';

// ────────────────────────────────────────────────
// TC-V: validate
// ────────────────────────────────────────────────

describe('validate', () => {
  let fx: Fixture;
  beforeEach(() => { fx = makeFixture([{ name: 'alice', model: 'qwen2.5:3b' }]); });
  afterEach(() => fx.cleanup());

  it('TC-V1: valid config exits 0 and prints ✓', async () => {
    const r = await cli(['validate', '--file', fx.configPath], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('✓');
    expect(r.stdout).toContain('1 agent');
  });

  it('TC-V2: valid config with pipes exits 0', async () => {
    const fx2 = makeFixture([
      { name: 'alice', model: 'test' },
      { name: 'bob', model: 'test', pipes: [{ from: 'alice' }] },
    ]);
    try {
      const r = await cli(['validate', '--file', fx2.configPath], { env: { BRACT_HOME: fx2.home } });
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('2 agents');
      expect(r.stdout).toContain('1 pipe');
    } finally {
      fx2.cleanup();
    }
  });

  it('TC-V3: missing file exits 1 with error', async () => {
    const r = await cli(['validate', '--file', '/nonexistent/bract.yml'], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(1);
    expect(r.stdout + r.stderr).toContain('cannot read file');
  });

  it('TC-V4: invalid YAML exits 1', async () => {
    const bad = join(fx.home, 'bad.yml');
    writeFileSync(bad, 'version: 1\nagents: [\n  bad yaml {\n', 'utf8');
    const r = await cli(['validate', '--file', bad], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(1);
  });

  it('TC-V5: missing required field exits 1', async () => {
    const bad = join(fx.home, 'bad.yml');
    writeFileSync(bad, 'version: 1\nagents:\n  - name: alice\n', 'utf8');
    const r = await cli(['validate', '--file', bad], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(1);
    expect(r.stdout + r.stderr).toContain('model');
  });

  it('TC-V6: pipe to unknown agent exits 1', async () => {
    const bad = join(fx.home, 'bad.yml');
    writeFileSync(bad, 'version: 1\nagents:\n  - name: alice\n    model: test\n    pipes:\n      - from: ghost\n', 'utf8');
    const r = await cli(['validate', '--file', bad], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(1);
    expect(r.stdout + r.stderr).toContain('ghost');
  });

  it('TC-V7: circular pipe exits 1', async () => {
    const bad = join(fx.home, 'bad.yml');
    writeFileSync(bad, 'version: 1\nagents:\n  - name: alice\n    model: test\n    pipes:\n      - from: bob\n  - name: bob\n    model: test\n    pipes:\n      - from: alice\n', 'utf8');
    const r = await cli(['validate', '--file', bad], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(1);
    expect(r.stdout + r.stderr).toContain('circular');
  });

  it('TC-V8: --json flag returns valid JSON', async () => {
    const r = await cli(['validate', '--file', fx.configPath, '--json'], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.valid).toBe(true);
    expect(parsed.agentCount).toBe(1);
  });

  it('TC-V9: --json on invalid config has valid:false', async () => {
    const bad = join(fx.home, 'bad.yml');
    writeFileSync(bad, 'version: 1\nagents:\n  - name: alice\n', 'utf8');
    const r = await cli(['validate', '--file', bad, '--json'], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(1);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.valid).toBe(false);
    expect(parsed.errors.length).toBeGreaterThan(0);
  });

  it('TC-V10: validate looks for ./bract.yml by default', async () => {
    const r = await cli(['validate'], { env: { BRACT_HOME: fx.home }, cwd: fx.home });
    expect(r.exitCode).toBe(0);
  });
});

// ────────────────────────────────────────────────
// TC-P: ps
// ────────────────────────────────────────────────

describe('ps', () => {
  let fx: Fixture;
  beforeEach(() => { fx = makeFixture([{ name: 'alice' }]); });
  afterEach(() => fx.cleanup());

  it('TC-P1: empty home prints "No agents"', async () => {
    const r = await cli(['ps'], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('No agents');
  });

  it('TC-P2: registered agent shows in table', async () => {
    registerAgent(fx.home, 'alice');
    const r = await cli(['ps'], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('alice');
    expect(r.stdout).toContain('idle');
  });

  it('TC-P3: --json returns array', async () => {
    registerAgent(fx.home, 'alice');
    const r = await cli(['ps', '--json'], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(0);
    const data = JSON.parse(r.stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data[0].name).toBe('alice');
  });

  it('TC-P4: --home flag overrides BRACT_HOME', async () => {
    registerAgent(fx.home, 'alice');
    const r = await cli(['--home', fx.home, 'ps']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('alice');
  });
});

// ────────────────────────────────────────────────
// TC-S/I/R: send, inbox, read
// ────────────────────────────────────────────────

describe('send + inbox + read', () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = makeFixture([{ name: 'alice' }]);
    registerAgent(fx.home, 'alice');
  });
  afterEach(() => fx.cleanup());

  it('TC-S1: send exits 0 and prints sent line', async () => {
    const r = await cli(['send', 'alice', 'hello world'], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('sent');
    expect(r.stdout).toContain('alice');
  });

  it('TC-S2: send to unknown agent exits 3', async () => {
    const r = await cli(['send', 'ghost', 'hi'], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(3);
    expect(r.stderr).toContain('ghost');
  });

  it('TC-I1: inbox shows pending message after send', async () => {
    await cli(['send', 'alice', 'ping'], { env: { BRACT_HOME: fx.home } });
    const r = await cli(['inbox', 'alice'], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('ping');
  });

  it('TC-I2: inbox --json returns array', async () => {
    await cli(['send', 'alice', 'test msg'], { env: { BRACT_HOME: fx.home } });
    const r = await cli(['inbox', 'alice', '--json'], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(0);
    const msgs = JSON.parse(r.stdout);
    expect(Array.isArray(msgs)).toBe(true);
    expect(msgs[0].body).toBe('test msg');
  });

  it('TC-I3: inbox unknown agent exits 3', async () => {
    const r = await cli(['inbox', 'ghost'], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(3);
  });

  it('TC-R1: read empty outbox exits 0 with "(empty)"', async () => {
    const r = await cli(['read', 'alice'], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('empty');
  });

  it('TC-R2: read shows outbox message', async () => {
    // Write a message directly into outbox
    const ts = Date.now();
    const id = `${ts}-abc`;
    const { join: pathJoin } = await import('node:path');
    const { writeFileSync: wfs } = await import('node:fs');
    const outboxDir = pathJoin(fx.home, 'agents', 'alice', 'outbox');
    wfs(pathJoin(outboxDir, `${id}.msg`), JSON.stringify({ id, from: 'alice', body: 'hello from agent', ts: new Date(ts).toISOString() }) + '\n', 'utf8');

    const r = await cli(['read', 'alice'], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('hello from agent');
  });

  it('TC-R3: read unknown agent exits 3', async () => {
    const r = await cli(['read', 'ghost'], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(3);
  });

  it('TC-S3: send reads body from stdin with -', async () => {
    const r = await cli(['send', 'alice', '-'], {
      env: { BRACT_HOME: fx.home },
      stdin: 'message via stdin',
    });
    expect(r.exitCode).toBe(0);
    const inbox = await cli(['inbox', 'alice', '--json'], { env: { BRACT_HOME: fx.home } });
    const msgs = JSON.parse(inbox.stdout);
    expect(msgs[0].body).toBe('message via stdin');
  });
});

// ────────────────────────────────────────────────
// TC-G: global flags
// ────────────────────────────────────────────────

describe('global flags', () => {
  it('TC-G1: no args prints usage, exits 0', async () => {
    const r = await cli([]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Usage:');
  });

  it('TC-G2: --help prints usage, exits 0', async () => {
    const r = await cli(['--help']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Usage:');
  });

  it('TC-G3: unknown command exits 2', async () => {
    const r = await cli(['notacommand']);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('unknown command');
  });

  it('TC-G4: --json after subcommand works', async () => {
    const fx = makeFixture([{ name: 'x' }]);
    registerAgent(fx.home, 'x');
    const r = await cli(['ps', '--json'], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(0);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
    fx.cleanup();
  });
});

// ────────────────────────────────────────────────
// TC-V: validate — additional schema rules
// ────────────────────────────────────────────────

describe('validate (additional)', () => {
  let fx: Fixture;
  beforeEach(() => { fx = makeFixture([{ name: 'alice', model: 'test' }]); });
  afterEach(() => fx.cleanup());

  it('TC-V11: agent name with uppercase letters exits 1', async () => {
    const bad = join(fx.home, 'bad.yml');
    writeFileSync(bad, 'version: 1\nagents:\n  - name: Alice\n    model: test\n', 'utf8');
    const r = await cli(['validate', '--file', bad], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/name|pattern/i);
  });

  it('TC-V12: agent name starting with digit exits 1', async () => {
    const bad = join(fx.home, 'bad.yml');
    writeFileSync(bad, 'version: 1\nagents:\n  - name: 1alice\n    model: test\n', 'utf8');
    const r = await cli(['validate', '--file', bad], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(1);
  });

  it('TC-V13: version != 1 exits 1', async () => {
    const bad = join(fx.home, 'bad.yml');
    writeFileSync(bad, 'version: 2\nagents:\n  - name: alice\n    model: test\n', 'utf8');
    const r = await cli(['validate', '--file', bad], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(1);
    expect(r.stdout + r.stderr).toContain('version');
  });

  it('TC-V14: env field that is not an object exits 1', async () => {
    const bad = join(fx.home, 'bad.yml');
    writeFileSync(
      bad,
      'version: 1\nagents:\n  - name: alice\n    model: test\n    env: "not-an-object"\n',
      'utf8',
    );
    const r = await cli(['validate', '--file', bad], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(1);
    expect(r.stdout + r.stderr).toContain('env');
  });

  it('TC-V15: pipe with filter field passes validation', async () => {
    const good = join(fx.home, 'good.yml');
    writeFileSync(
      good,
      'version: 1\nagents:\n  - name: alice\n    model: test\n  - name: bob\n    model: test\n    pipes:\n      - from: alice\n        filter: "keyword"\n',
      'utf8',
    );
    const r = await cli(['validate', '--file', good], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('✓');
  });

  it('TC-V16: agents array with wrong version but correct structure shows version error', async () => {
    const bad = join(fx.home, 'bad.yml');
    writeFileSync(bad, 'version: "one"\nagents:\n  - name: alice\n    model: test\n', 'utf8');
    const r = await cli(['validate', '--file', bad], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(1);
  });

  it('TC-V17: empty agents array exits 1', async () => {
    const bad = join(fx.home, 'bad.yml');
    writeFileSync(bad, 'version: 1\nagents: []\n', 'utf8');
    const r = await cli(['validate', '--file', bad], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(1);
    expect(r.stdout + r.stderr).toContain('agents');
  });
});

// ────────────────────────────────────────────────
// TC-I: inbox — additional behaviors
// ────────────────────────────────────────────────

describe('inbox (additional)', () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = makeFixture([{ name: 'alice' }]);
    registerAgent(fx.home, 'alice');
  });
  afterEach(() => fx.cleanup());

  it('TC-I4: empty inbox shows "(empty)"', async () => {
    const r = await cli(['inbox', 'alice'], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('empty');
  });

  it('TC-I5: inbox shows message count in header', async () => {
    await cli(['send', 'alice', 'first'], { env: { BRACT_HOME: fx.home } });
    await cli(['send', 'alice', 'second'], { env: { BRACT_HOME: fx.home } });
    const r = await cli(['inbox', 'alice'], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('2');
  });

  it('TC-I6: inbox without agent name exits 2', async () => {
    const r = await cli(['inbox'], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('agent name required');
  });
});

// ────────────────────────────────────────────────
// TC-R: read — additional behaviors
// ────────────────────────────────────────────────

describe('read (additional)', () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = makeFixture([{ name: 'alice' }]);
    registerAgent(fx.home, 'alice');
  });
  afterEach(() => fx.cleanup());

  it('TC-R4: read --json on empty outbox returns empty array', async () => {
    const r = await cli(['read', 'alice', '--json'], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(0);
    const data = JSON.parse(r.stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(0);
  });

  it('TC-R5: read --json with messages returns array with body fields', async () => {
    // Write two outbox messages directly
    const outboxDir = join(fx.home, 'agents', 'alice', 'outbox');
    mkdirSync(outboxDir, { recursive: true });
    const now = Date.now();
    for (const [i, body] of ['first reply', 'second reply'].entries()) {
      const id = `${now + i}-test`;
      writeFileSync(
        join(outboxDir, `${id}.msg`),
        JSON.stringify({ id, from: 'alice', body, ts: new Date(now + i).toISOString() }) + '\n',
        'utf8',
      );
    }

    const r = await cli(['read', 'alice', '--json'], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(0);
    const data = JSON.parse(r.stdout);
    expect(Array.isArray(data)).toBe(true);
    // Without --all, read returns only the last message
    expect(data.length).toBe(1);
    expect(data[0].body).toBe('second reply');
  });

  it('TC-R6: read --all --json returns all messages', async () => {
    const outboxDir = join(fx.home, 'agents', 'alice', 'outbox');
    mkdirSync(outboxDir, { recursive: true });
    const now = Date.now();
    for (const [i, body] of ['msg1', 'msg2', 'msg3'].entries()) {
      const id = `${now + i}-test`;
      writeFileSync(
        join(outboxDir, `${id}.msg`),
        JSON.stringify({ id, from: 'alice', body, ts: new Date(now + i).toISOString() }) + '\n',
        'utf8',
      );
    }

    const r = await cli(['read', 'alice', '--all', '--json'], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(0);
    const data = JSON.parse(r.stdout);
    expect(data.length).toBe(3);
  });

  it('TC-R7: read without agent name exits 2', async () => {
    const r = await cli(['read'], { env: { BRACT_HOME: fx.home } });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('agent name required');
  });
});
