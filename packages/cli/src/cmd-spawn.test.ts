/**
 * @file cmd-spawn.test.ts
 * Tests for `bract spawn` — spawns an agent from bract.yml.
 */
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseBractConfig, selectAgents, type BractConfig } from './cmd-spawn.js';

let tmpDir: string;
let bractHome: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'bract-spawn-'));
  bractHome = join(tmpDir, 'home');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeYaml(content: string, filename = 'bract.yml'): string {
  const path = join(tmpDir, filename);
  writeFileSync(path, content);
  return path;
}

// ---- parseBractConfig ----

describe('parseBractConfig', () => {
  test('parses a minimal valid config', async () => {
    const file = writeYaml('version: 1\nagents:\n  - name: test-agent\n    model: qwen2.5:7b\n');
    const config = await parseBractConfig(file);
    expect(config.version).toBe(1);
    expect(config.agents).toHaveLength(1);
    expect(config.agents[0]?.name).toBe('test-agent');
    expect(config.agents[0]?.model).toBe('qwen2.5:7b');
  });

  test('parses system prompt and home', async () => {
    const file = writeYaml([
      'version: 1',
      'home: /custom/home',
      'agents:',
      '  - name: assistant',
      '    model: deepseek-r1:14b',
      '    system: You are a helpful assistant.',
    ].join('\n'));
    const config = await parseBractConfig(file);
    expect(config.home).toBe('/custom/home');
    expect(config.agents[0]?.system).toBe('You are a helpful assistant.');
  });

  test('throws on missing file', async () => {
    await expect(parseBractConfig(join(tmpDir, 'nonexistent.yml'))).rejects.toThrow();
  });

  test('throws on invalid YAML', async () => {
    const file = writeYaml('version: 1\nagents: [\nunterminated');
    await expect(parseBractConfig(file)).rejects.toThrow();
  });

  test('throws when version is not 1', async () => {
    const file = writeYaml('version: 2\nagents:\n  - name: x\n    model: y\n');
    await expect(parseBractConfig(file)).rejects.toThrow(/version/);
  });

  test('throws when agents array is missing', async () => {
    const file = writeYaml('version: 1\n');
    await expect(parseBractConfig(file)).rejects.toThrow(/agents/);
  });
});

// ---- selectAgents ----

describe('selectAgents', () => {
  const config: BractConfig = {
    version: 1,
    agents: [
      { name: 'researcher', model: 'qwen2.5:7b' },
      { name: 'writer', model: 'deepseek-r1:14b' },
    ],
  };

  test('selects single agent by name', () => {
    const agents = selectAgents(config, 'researcher');
    expect(agents).toHaveLength(1);
    expect(agents[0]?.name).toBe('researcher');
  });

  test('selects all agents when name is undefined', () => {
    const agents = selectAgents(config, undefined, true);
    expect(agents).toHaveLength(2);
  });

  test('throws on unknown agent name', () => {
    expect(() => selectAgents(config, 'unknown')).toThrow(/unknown/i);
  });

  test('throws when neither name nor --all provided', () => {
    expect(() => selectAgents(config)).toThrow(/name/i);
  });
});
