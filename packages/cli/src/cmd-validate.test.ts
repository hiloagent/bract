/**
 * @file cmd-validate.test.ts
 * Tests for `bract validate` — schema validation and pipe cycle detection.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cmdValidate, type ValidationResult } from './cmd-validate.js';

let tmpDir: string;
let originalExit: typeof process.exit;
let originalStdout: typeof process.stdout.write;
let lastOutput: string;
let lastExitCode: number | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'bract-validate-'));
  lastOutput = '';
  lastExitCode = undefined;

  originalExit = process.exit;

  process.exit = (code?: number) => {
    lastExitCode = code;
    throw new Error(`process.exit(${code})`);
  };

  originalStdout = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Buffer) => {
    lastOutput += typeof chunk === 'string' ? chunk : chunk.toString();
    return true;
  };
});

afterEach(() => {
  process.exit = originalExit;
  process.stdout.write = originalStdout;
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeYaml(content: string, filename = 'bract.yml'): string {
  const path = join(tmpDir, filename);
  writeFileSync(path, content);
  return path;
}

async function runValidate(file: string, json?: boolean): Promise<{ output: string; exitCode: number | undefined }> {
  try {
    await cmdValidate({ file, json });
  } catch {
    // process.exit throws in tests
  }
  return { output: lastOutput, exitCode: lastExitCode };
}

describe('cmdValidate — valid configs', () => {
  test('minimal valid config', async () => {
    const file = writeYaml('version: 1\nagents:\n  - name: test-agent\n    model: gpt-4\n');
    const { output, exitCode } = await runValidate(file);
    expect(output).toContain('✓');
    expect(output).toContain('1 agent');
    expect(output).toContain('0 pipes');
    expect(exitCode).toBeUndefined();
  });

  test('valid config with pipes', async () => {
    const file = writeYaml(
      'version: 1\nagents:\n  - name: producer\n    model: gpt-4\n  - name: consumer\n    model: gpt-4\n    pipes:\n      - from: producer\n',
    );
    const { output, exitCode } = await runValidate(file);
    expect(output).toContain('✓');
    expect(output).toContain('2 agents');
    expect(output).toContain('1 pipe');
    expect(exitCode).toBeUndefined();
  });

  test('valid config with all optional fields', async () => {
    const file = writeYaml(
      [
        'version: 1',
        'home: /tmp/bract',
        'agents:',
        '  - name: my-agent',
        '    model: claude-sonnet-4-6',
        '    system: You are helpful.',
        '    restart: on-failure',
        '    env:',
        '      API_KEY: secret',
        '    memory:',
        '      preferences: prefer short responses',
        '    triggers:',
        '      - cron: "0 * * * *"',
        '        message: scan',
        '      - webhook: /hooks/my-agent',
        '    skills:',
        '      - my-skill',
        '    mcp:',
        '      - server: my-mcp-server',
        '        config:',
        '          port: 8080',
      ].join('\n'),
    );
    const { exitCode } = await runValidate(file);
    expect(exitCode).toBeUndefined();
  });

  test('--json flag outputs JSON', async () => {
    const file = writeYaml('version: 1\nagents:\n  - name: agent-a\n    model: gpt-4\n');
    const { output, exitCode } = await runValidate(file, true);
    const parsed = JSON.parse(output) as ValidationResult;
    expect(parsed.valid).toBe(true);
    expect(parsed.agentCount).toBe(1);
    expect(parsed.errors).toEqual([]);
    expect(exitCode).toBeUndefined();
  });
});

describe('cmdValidate — schema errors', () => {
  test('missing version', async () => {
    const file = writeYaml('agents:\n  - name: a\n    model: gpt-4\n');
    const { output, exitCode } = await runValidate(file);
    expect(output).toContain('✗');
    expect(output).toContain('version');
    expect(exitCode).toBe(1);
  });

  test('wrong version', async () => {
    const file = writeYaml('version: 2\nagents:\n  - name: a\n    model: gpt-4\n');
    const { output, exitCode } = await runValidate(file);
    expect(output).toContain('version');
    expect(exitCode).toBe(1);
  });

  test('missing agents', async () => {
    const file = writeYaml('version: 1\n');
    const { output, exitCode } = await runValidate(file);
    expect(output).toContain('agents');
    expect(exitCode).toBe(1);
  });

  test('empty agents array', async () => {
    const file = writeYaml('version: 1\nagents: []\n');
    const { output, exitCode } = await runValidate(file);
    expect(output).toContain('agents');
    expect(exitCode).toBe(1);
  });

  test('invalid agent name pattern', async () => {
    const file = writeYaml('version: 1\nagents:\n  - name: My_Agent\n    model: gpt-4\n');
    const { output, exitCode } = await runValidate(file);
    expect(output).toContain('agents[0].name');
    expect(exitCode).toBe(1);
  });

  test('invalid restart value', async () => {
    const file = writeYaml(
      'version: 1\nagents:\n  - name: a\n    model: gpt-4\n    restart: maybe\n',
    );
    const { output, exitCode } = await runValidate(file);
    expect(output).toContain('restart');
    expect(exitCode).toBe(1);
  });

  test('unknown top-level property', async () => {
    const file = writeYaml('version: 1\nagents:\n  - name: a\n    model: gpt-4\nunknown: x\n');
    const { output, exitCode } = await runValidate(file);
    expect(output).toContain('unknown');
    expect(exitCode).toBe(1);
  });

  test('YAML parse error', async () => {
    const file = writeYaml('version: 1\n  bad: indent\n');
    const { output, exitCode } = await runValidate(file);
    expect(output).toContain('✗');
    expect(exitCode).toBe(1);
  });

  test('file not found', async () => {
    const { output, exitCode } = await runValidate(join(tmpDir, 'nonexistent.yml'));
    expect(output).toContain('cannot read file');
    expect(exitCode).toBe(1);
  });
});

describe('cmdValidate — pipe errors', () => {
  test('pipe from unknown agent', async () => {
    const file = writeYaml(
      'version: 1\nagents:\n  - name: consumer\n    model: gpt-4\n    pipes:\n      - from: ghost\n',
    );
    const { output, exitCode } = await runValidate(file);
    expect(output).toContain('unknown agent');
    expect(output).toContain('ghost');
    expect(exitCode).toBe(1);
  });

  test('direct cycle: a pipes from b, b pipes from a', async () => {
    const file = writeYaml(
      [
        'version: 1',
        'agents:',
        '  - name: agent-a',
        '    model: gpt-4',
        '    pipes:',
        '      - from: agent-b',
        '  - name: agent-b',
        '    model: gpt-4',
        '    pipes:',
        '      - from: agent-a',
      ].join('\n'),
    );
    const { output, exitCode } = await runValidate(file);
    expect(output).toContain('circular dependency');
    expect(exitCode).toBe(1);
  });

  test('three-agent cycle', async () => {
    const file = writeYaml(
      [
        'version: 1',
        'agents:',
        '  - name: alpha',
        '    model: gpt-4',
        '    pipes:',
        '      - from: gamma',
        '  - name: beta',
        '    model: gpt-4',
        '    pipes:',
        '      - from: alpha',
        '  - name: gamma',
        '    model: gpt-4',
        '    pipes:',
        '      - from: beta',
      ].join('\n'),
    );
    const { output, exitCode } = await runValidate(file);
    expect(output).toContain('circular dependency');
    expect(exitCode).toBe(1);
  });

  test('valid linear pipeline: no cycle', async () => {
    const file = writeYaml(
      [
        'version: 1',
        'agents:',
        '  - name: source',
        '    model: gpt-4',
        '  - name: middle',
        '    model: gpt-4',
        '    pipes:',
        '      - from: source',
        '  - name: sink',
        '    model: gpt-4',
        '    pipes:',
        '      - from: middle',
      ].join('\n'),
    );
    const { output, exitCode } = await runValidate(file);
    expect(output).toContain('✓');
    expect(exitCode).toBeUndefined();
  });
});
