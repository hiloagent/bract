/**
 * @file helpers/fixtures.ts
 * Creates isolated BRACT_HOME directories and bract.yml configs for each test.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface Fixture {
  home: string;
  configPath: string;
  /** Env vars to pass to cli() calls */
  env: Record<string, string>;
  /** Clean up temp directory */
  cleanup(): void;
}

export interface AgentDef {
  name: string;
  model?: string;
  system?: string;
  restart?: 'always' | 'on-failure' | 'never';
}

export interface PipeDef {
  from: string;
  to: string;
}

/**
 * Create an isolated fixture with a temp BRACT_HOME and a bract.yml.
 * Call fixture.cleanup() in afterEach/afterAll.
 */
export function makeFixture(
  agents: AgentDef[] = [{ name: 'assistant', model: 'test-model' }],
  pipes: PipeDef[] = [],
): Fixture {
  const home = mkdtempSync(join(tmpdir(), 'bract-e2e-'));
  const configPath = join(home, 'bract.yml');



  // pipes are per-agent in bract.yml: agent.pipes[].from
  // Build a map of target -> [from, ...] for injection into agent yaml
  const pipesByTarget = new Map<string, string[]>();
  for (const p of pipes) {
    const list = pipesByTarget.get(p.to) ?? [];
    list.push(p.from);
    pipesByTarget.set(p.to, list);
  }

  const agentYamlWithPipes = agents
    .map((a) => {
      let s = `  - name: ${a.name}\n    model: ${a.model ?? 'test-model'}`;
      if (a.system) s += `\n    system: "${a.system.replace(/"/g, '\\"')}"`;
      if (a.restart) s += `\n    restart: ${a.restart}`;
      const froms = pipesByTarget.get(a.name) ?? [];
      if (froms.length > 0) {
        s += '\n    pipes:\n' + froms.map(f => `      - from: ${f}`).join('\n');
      }
      return s;
    })
    .join('\n');

  writeFileSync(
    configPath,
    `version: 1\nagents:\n${agentYamlWithPipes}\n`,
    'utf8',
  );

  return {
    home,
    configPath,
    env: { BRACT_HOME: home },
    cleanup() {
      try { rmSync(home, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}

/** Write a file inside the fixture home */
export function writeFixtureFile(home: string, rel: string, content: string): void {
  const full = join(home, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

/**
 * Pre-register an agent in the process table so send/read/inbox commands work.
 * Sets status=idle and writes the model file — no process is spawned.
 */
export function registerAgent(home: string, name: string, model = 'test-model'): void {
  const agentDir = join(home, 'agents', name);
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, 'status'), 'idle\n', 'utf8');
  writeFileSync(join(agentDir, 'model'), model + '\n', 'utf8');
}
