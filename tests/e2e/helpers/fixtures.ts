/**
 * Test fixture helpers — create isolated BRACT_HOME directories with bract.yml.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export interface AgentFixtureConfig {
  name: string;
  model?: string;
  system?: string;
  restart?: 'always' | 'on-failure' | 'never';
  pipes?: Array<{ from: string; filter?: string }>;
}

export interface Fixture {
  home: string;
  configPath: string;
  cleanup: () => void;
}

/**
 * Create a temporary BRACT_HOME directory with a bract.yml.
 * Returns a Fixture with the home path, config path, and cleanup function.
 */
export function makeFixture(
  agents: AgentFixtureConfig[],
): Fixture {
  const home = mkdtempSync(join(tmpdir(), 'bract-e2e-'));
  const configPath = join(home, 'bract.yml');

  const agentYaml = agents.map((a) => {
    const lines: string[] = [
      `  - name: ${a.name}`,
      `    model: ${a.model ?? 'test-model'}`,
    ];
    if (a.system) lines.push(`    system: "${a.system}"`);
    if (a.restart) lines.push(`    restart: ${a.restart}`);
    if (a.pipes && a.pipes.length > 0) {
      lines.push('    pipes:');
      for (const p of a.pipes) {
        lines.push(`      - from: ${p.from}`);
        if (p.filter) lines.push(`        filter: "${p.filter}"`);
      }
    }
    return lines.join('\n');
  }).join('\n');

  const yaml = `version: 1\nagents:\n${agentYaml}\n`;
  writeFileSync(configPath, yaml, 'utf8');

  return {
    home,
    configPath,
    cleanup: () => {
      try { rmSync(home, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}

/**
 * Pre-register an agent in the process table so send/inbox/read commands work
 * without needing to spawn it first.
 */
export function registerAgent(home: string, name: string, model = 'test-model'): void {
  const agentDir = join(home, 'agents', name);
  mkdirSync(join(agentDir, 'inbox'), { recursive: true });
  mkdirSync(join(agentDir, 'outbox'), { recursive: true });
  mkdirSync(join(agentDir, 'memory'), { recursive: true });
  mkdirSync(join(agentDir, 'logs'), { recursive: true });
  writeFileSync(join(agentDir, 'model'), model + '\n', 'utf8');
  writeFileSync(join(agentDir, 'status'), 'idle\n', 'utf8');
  writeFileSync(join(agentDir, 'pid'), '\n', 'utf8');
}

/**
 * Write a message directly into an agent's inbox (bypasses `bract send`).
 */
export function writeInboxMessage(
  home: string,
  agentName: string,
  body: string,
  from = 'test',
): string {
  const ts = Date.now();
  const id = `${ts}-${Math.random().toString(36).slice(2, 8)}`;
  const inboxDir = join(home, 'agents', agentName, 'inbox');
  mkdirSync(inboxDir, { recursive: true });
  const msgPath = join(inboxDir, `${id}.msg`);
  writeFileSync(msgPath, JSON.stringify({ id, from, body, ts: new Date(ts).toISOString() }) + '\n', 'utf8');
  return id;
}
