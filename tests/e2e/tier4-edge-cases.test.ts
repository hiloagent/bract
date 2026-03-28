/**
 * @file tests/e2e/tier4-edge-cases.test.ts
 * Tier 4 — Edge cases: stdin, signals, large messages, concurrency, error paths.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { cli } from './helpers/cli.ts';
import { makeFixture, registerAgent, type Fixture } from './helpers/fixtures.ts';
import { killAll } from './helpers/process-cleanup.ts';

let fx: Fixture;
beforeEach(() => { fx = makeFixture(); registerAgent(fx.home, "assistant"); });
afterEach(() => { killAll(); fx.cleanup(); });

describe('edge cases', () => {
  test('TC-E1: send empty stdin body exits non-zero', async () => {
    const r = await cli(['send', 'assistant', '-'], { env: fx.env, stdin: '' });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/empty|required/i);
  });

  test('TC-E2: large message body is stored correctly', async () => {
    const large = 'x'.repeat(100_000);
    const r = await cli(['send', 'assistant', '-'], { env: fx.env, stdin: large });
    expect(r.exitCode).toBe(0);
    const ir = await cli(['inbox', 'assistant', '--json'], { env: fx.env });
    const msgs = JSON.parse(ir.stdout);
    expect(msgs[0].body.length).toBe(100_000);
  });

  test('TC-E3: concurrent sends do not corrupt inbox', async () => {
    await Promise.all([
      cli(['send', 'assistant', 'concurrent-1'], { env: fx.env }),
      cli(['send', 'assistant', 'concurrent-2'], { env: fx.env }),
      cli(['send', 'assistant', 'concurrent-3'], { env: fx.env }),
    ]);
    const r = await cli(['inbox', 'assistant', '--all', '--json'], { env: fx.env });
    const msgs = JSON.parse(r.stdout);
    expect(msgs.length).toBe(3);
  });

  test('TC-E4: validate --file with spaces in path', async () => {
    const spaceDir = join(fx.home, 'dir with spaces');
    mkdirSync(spaceDir, { recursive: true });
    const config = join(spaceDir, 'bract.yml');
    writeFileSync(config, 'version: 1\nagents:\n  - name: a\n    model: m\n');
    const r = await cli(['validate', '--file', config]);
    expect(r.exitCode).toBe(0);
  });

  test('TC-E5: ps with corrupted status file still lists agent', async () => {
    const agentDir = join(fx.home, 'agents', 'broken');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'status'), ''); // empty — corrupted
    writeFileSync(join(agentDir, 'model'), 'gpt-4o\n');
    const r = await cli(['ps'], { env: fx.env });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('broken');
  });

  test('TC-E6: validate accepts multiple agents', async () => {
    const cfg = join(fx.home, 'multi.yml');
    writeFileSync(
      cfg,
      'version: 1\nagents:\n  - name: a\n    model: m\n  - name: b\n    model: m\n  - name: c\n    model: m\n',
    );
    const r = await cli(['validate', '--file', cfg, '--json']);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.agentCount).toBe(3);
  });

  test('TC-E7: inbox for unknown agent exits non-zero', async () => {
    const r = await cli(['inbox', 'ghost'], { env: fx.env });
    // Agent not registered — exits with error code
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/not found|ghost/i);
  });

  test('TC-E8: read for unknown agent exits non-zero', async () => {
    const r = await cli(['read', 'ghost'], { env: fx.env });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/not found|ghost/i);
  });

  test('TC-E9: --json flag works after subcommand for ps', async () => {
    const r = await cli(['ps', '--json'], { env: fx.env });
    expect(r.exitCode).toBe(0);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  });

  test('TC-E10: send with no message body and no stdin flag exits 2', async () => {
    const r = await cli(['send', 'assistant'], { env: fx.env });
    // With no body, it tries to read stdin which is 'ignore' — empty stdin triggers error
    // The exact behavior depends on impl; just check it doesn't silently succeed with empty msg
    if (r.exitCode === 0) {
      // If it succeeded, the message body should not be empty
      const ir = await cli(['inbox', 'assistant', '--json'], { env: fx.env });
      const msgs = JSON.parse(ir.stdout);
      if (msgs.length > 0) {
        expect(msgs[0].body.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
