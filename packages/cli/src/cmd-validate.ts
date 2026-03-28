/**
 * @file cmd-validate.ts
 * Implementation of `bract validate` — validates bract.yml against JSON schema and pipe rules.
 * @module @losoft/bract-cli/cmd-validate
 */
import { resolve } from 'node:path';

export interface ValidateOptions {
  file?: string;
  json?: boolean;
}

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  file: string;
  agentCount: number;
  pipeCount: number;
  errors: ValidationError[];
}

// ---- Schema validation ----

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

function err(path: string, message: string): ValidationError {
  return { path, message };
}

function validateAgent(agent: unknown, idx: number): ValidationError[] {
  const errors: ValidationError[] = [];
  const base = `agents[${idx}]`;

  if (typeof agent !== 'object' || agent === null || Array.isArray(agent)) {
    return [err(base, 'must be an object')];
  }

  const a = agent as Record<string, unknown>;
  const known = new Set([
    'name', 'model', 'system', 'restart', 'env', 'memory',
    'triggers', 'pipes', 'mcp', 'skills',
  ]);
  for (const key of Object.keys(a)) {
    if (!known.has(key)) errors.push(err(`${base}.${key}`, 'unknown property'));
  }

  if (typeof a.name !== 'string') {
    errors.push(err(`${base}.name`, 'required, must be a string'));
  } else if (!NAME_PATTERN.test(a.name)) {
    errors.push(err(`${base}.name`, 'must match pattern [a-z][a-z0-9-]*'));
  }

  if (typeof a.model !== 'string' || a.model.length === 0) {
    errors.push(err(`${base}.model`, 'required, must be a non-empty string'));
  }

  if (a.system !== undefined && typeof a.system !== 'string') {
    errors.push(err(`${base}.system`, 'must be a string'));
  }

  if (a.restart !== undefined) {
    if (!['always', 'on-failure', 'never'].includes(a.restart as string)) {
      errors.push(err(`${base}.restart`, 'must be "always", "on-failure", or "never"'));
    }
  }

  if (a.env !== undefined) {
    if (typeof a.env !== 'object' || a.env === null || Array.isArray(a.env)) {
      errors.push(err(`${base}.env`, 'must be an object'));
    } else {
      for (const [k, v] of Object.entries(a.env as Record<string, unknown>)) {
        if (typeof v !== 'string') {
          errors.push(err(`${base}.env.${k}`, 'must be a string'));
        }
      }
    }
  }

  if (a.memory !== undefined) {
    if (typeof a.memory !== 'object' || a.memory === null || Array.isArray(a.memory)) {
      errors.push(err(`${base}.memory`, 'must be an object'));
    } else {
      for (const [k, v] of Object.entries(a.memory as Record<string, unknown>)) {
        if (typeof v !== 'string') {
          errors.push(err(`${base}.memory.${k}`, 'must be a string'));
        }
      }
    }
  }

  if (a.triggers !== undefined) {
    if (!Array.isArray(a.triggers)) {
      errors.push(err(`${base}.triggers`, 'must be an array'));
    } else {
      for (let i = 0; i < a.triggers.length; i++) {
        errors.push(...validateTrigger(a.triggers[i], `${base}.triggers[${i}]`));
      }
    }
  }

  if (a.pipes !== undefined) {
    if (!Array.isArray(a.pipes)) {
      errors.push(err(`${base}.pipes`, 'must be an array'));
    } else {
      for (let i = 0; i < a.pipes.length; i++) {
        errors.push(...validatePipe(a.pipes[i], `${base}.pipes[${i}]`));
      }
    }
  }

  if (a.mcp !== undefined) {
    if (!Array.isArray(a.mcp)) {
      errors.push(err(`${base}.mcp`, 'must be an array'));
    } else {
      for (let i = 0; i < a.mcp.length; i++) {
        errors.push(...validateMcp(a.mcp[i], `${base}.mcp[${i}]`));
      }
    }
  }

  if (a.skills !== undefined) {
    if (!Array.isArray(a.skills)) {
      errors.push(err(`${base}.skills`, 'must be an array'));
    } else {
      for (let i = 0; i < a.skills.length; i++) {
        if (typeof a.skills[i] !== 'string') {
          errors.push(err(`${base}.skills[${i}]`, 'must be a string'));
        }
      }
    }
  }

  return errors;
}

function validateTrigger(trigger: unknown, path: string): ValidationError[] {
  const errors: ValidationError[] = [];
  if (typeof trigger !== 'object' || trigger === null || Array.isArray(trigger)) {
    return [err(path, 'must be an object')];
  }
  const t = trigger as Record<string, unknown>;
  const known = new Set(['cron', 'webhook', 'message']);
  for (const key of Object.keys(t)) {
    if (!known.has(key)) errors.push(err(`${path}.${key}`, 'unknown property'));
  }
  if (t.cron !== undefined && typeof t.cron !== 'string') {
    errors.push(err(`${path}.cron`, 'must be a string'));
  }
  if (t.webhook !== undefined) {
    if (typeof t.webhook !== 'string') {
      errors.push(err(`${path}.webhook`, 'must be a string'));
    } else if (!t.webhook.startsWith('/')) {
      errors.push(err(`${path}.webhook`, 'must start with "/"'));
    }
  }
  if (t.message !== undefined && typeof t.message !== 'string') {
    errors.push(err(`${path}.message`, 'must be a string'));
  }
  return errors;
}

function validatePipe(pipe: unknown, path: string): ValidationError[] {
  const errors: ValidationError[] = [];
  if (typeof pipe !== 'object' || pipe === null || Array.isArray(pipe)) {
    return [err(path, 'must be an object')];
  }
  const p = pipe as Record<string, unknown>;
  const known = new Set(['from', 'filter']);
  for (const key of Object.keys(p)) {
    if (!known.has(key)) errors.push(err(`${path}.${key}`, 'unknown property'));
  }
  if (typeof p.from !== 'string') {
    errors.push(err(`${path}.from`, 'required, must be a string'));
  } else if (!NAME_PATTERN.test(p.from)) {
    errors.push(err(`${path}.from`, 'must match pattern [a-z][a-z0-9-]*'));
  }
  if (p.filter !== undefined && typeof p.filter !== 'string') {
    errors.push(err(`${path}.filter`, 'must be a string'));
  }
  return errors;
}

function validateMcp(mcp: unknown, path: string): ValidationError[] {
  const errors: ValidationError[] = [];
  if (typeof mcp !== 'object' || mcp === null || Array.isArray(mcp)) {
    return [err(path, 'must be an object')];
  }
  const m = mcp as Record<string, unknown>;
  const known = new Set(['server', 'config']);
  for (const key of Object.keys(m)) {
    if (!known.has(key)) errors.push(err(`${path}.${key}`, 'unknown property'));
  }
  if (typeof m.server !== 'string' || m.server.length === 0) {
    errors.push(err(`${path}.server`, 'required, must be a non-empty string'));
  }
  return errors;
}

function validateSchema(config: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return [err('', 'config must be an object')];
  }

  const c = config as Record<string, unknown>;
  const known = new Set(['version', 'home', 'agents']);
  for (const key of Object.keys(c)) {
    if (!known.has(key)) errors.push(err(key, 'unknown property'));
  }

  if (!Number.isInteger(c.version) || c.version !== 1) {
    errors.push(err('version', 'required, must be integer 1'));
  }

  if (c.home !== undefined && typeof c.home !== 'string') {
    errors.push(err('home', 'must be a string'));
  }

  if (!Array.isArray(c.agents)) {
    errors.push(err('agents', 'required, must be an array'));
  } else if (c.agents.length === 0) {
    errors.push(err('agents', 'must have at least 1 item'));
  } else {
    for (let i = 0; i < c.agents.length; i++) {
      errors.push(...validateAgent(c.agents[i], i));
    }
  }

  return errors;
}

// ---- Pipe validation ----

interface PipeRef {
  agentName: string;
  from: string;
}

function collectPipes(config: Record<string, unknown>): PipeRef[] {
  const refs: PipeRef[] = [];
  const agents = config.agents as Array<Record<string, unknown>>;
  if (!Array.isArray(agents)) return refs;
  for (const agent of agents) {
    if (typeof agent.name !== 'string') continue;
    if (!Array.isArray(agent.pipes)) continue;
    for (const pipe of agent.pipes as Array<Record<string, unknown>>) {
      if (typeof pipe.from === 'string') {
        refs.push({ agentName: agent.name, from: pipe.from });
      }
    }
  }
  return refs;
}

function validatePipes(config: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = [];
  const agents = config.agents as Array<Record<string, unknown>>;
  if (!Array.isArray(agents)) return errors;

  const agentNames = new Set(
    agents.filter((a) => typeof a.name === 'string').map((a) => a.name as string),
  );

  const pipes = collectPipes(config);

  // Check unknown references
  for (const ref of pipes) {
    if (!agentNames.has(ref.from)) {
      errors.push(
        err('pipes', `"${ref.agentName}" pipes from unknown agent "${ref.from}"`),
      );
    }
  }

  // Build adjacency: agent -> list of agents it receives from (edges point from consumer to producer)
  // For cycle detection: A pipes from B means A depends on B, edge A -> B
  const adj = new Map<string, string[]>();
  for (const name of agentNames) adj.set(name, []);
  for (const ref of pipes) {
    if (agentNames.has(ref.from)) {
      adj.get(ref.agentName)!.push(ref.from);
    }
  }

  // DFS three-colour cycle detection
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const name of agentNames) color.set(name, WHITE);

  const cycleErrors: string[] = [];

  function dfs(node: string, path: string[]): void {
    color.set(node, GRAY);
    for (const neighbour of adj.get(node) ?? []) {
      if (color.get(neighbour) === GRAY) {
        const cycle = [...path, node, neighbour].join(' → ');
        cycleErrors.push(cycle);
      } else if (color.get(neighbour) === WHITE) {
        dfs(neighbour, [...path, node]);
      }
    }
    color.set(node, BLACK);
  }

  for (const name of agentNames) {
    if (color.get(name) === WHITE) dfs(name, []);
  }

  for (const cycle of cycleErrors) {
    errors.push(err('pipes', `circular dependency detected: ${cycle}`));
  }

  return errors;
}

// ---- Count helpers ----

function countPipes(config: Record<string, unknown>): number {
  const agents = config.agents as Array<Record<string, unknown>>;
  if (!Array.isArray(agents)) return 0;
  return agents.reduce((sum, a) => sum + (Array.isArray(a.pipes) ? a.pipes.length : 0), 0);
}

// ---- Entry point ----

/** Validates a bract.yml file against the schema and pipe rules. */
export async function cmdValidate(opts: ValidateOptions = {}): Promise<void> {
  const filePath = resolve(opts.file ?? 'bract.yml');

  let raw: string;
  try {
    raw = await Bun.file(filePath).text();
  } catch {
    const result: ValidationResult = {
      valid: false,
      file: filePath,
      agentCount: 0,
      pipeCount: 0,
      errors: [{ path: '', message: `cannot read file: ${filePath}` }],
    };
    outputResult(result, opts.json);
    process.exit(1);
    return;
  }

  let config: unknown;
  try {
    config = Bun.YAML.parse(raw);
  } catch (e) {
    const result: ValidationResult = {
      valid: false,
      file: filePath,
      agentCount: 0,
      pipeCount: 0,
      errors: [{ path: '', message: `YAML parse error: ${(e as Error).message}` }],
    };
    outputResult(result, opts.json);
    process.exit(1);
    return;
  }

  const schemaErrors = validateSchema(config);
  const pipeErrors =
    schemaErrors.length === 0
      ? validatePipes(config as Record<string, unknown>)
      : [];

  const errors = [...schemaErrors, ...pipeErrors];
  const c = config as Record<string, unknown>;
  const agentCount = Array.isArray(c.agents) ? c.agents.length : 0;
  const pipeCount = schemaErrors.length === 0 ? countPipes(c) : 0;

  const result: ValidationResult = {
    valid: errors.length === 0,
    file: filePath,
    agentCount,
    pipeCount,
    errors,
  };

  outputResult(result, opts.json);
  if (!result.valid) process.exit(1);
}

function outputResult(result: ValidationResult, json?: boolean): void {
  if (json) {
    // JSON always goes to stdout (consumers can check result.valid)
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  if (result.valid) {
    process.stdout.write(
      `✓ ${result.file} is valid (${result.agentCount} agent${result.agentCount !== 1 ? 's' : ''}, ${result.pipeCount} pipe${result.pipeCount !== 1 ? 's' : ''})\n`,
    );
  } else {
    process.stderr.write(
      `✗ ${result.file} has ${result.errors.length} error${result.errors.length !== 1 ? 's' : ''}:\n`,
    );
    for (const e of result.errors) {
      const loc = e.path ? `  - ${e.path}: ${e.message}\n` : `  - ${e.message}\n`;
      process.stderr.write(loc);
    }
  }
}
