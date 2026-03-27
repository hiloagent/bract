/**
 * @file agent-worker.ts
 * Subprocess entry point for a detached bract agent.
 *
 * Reads agent configuration from environment variables set by cmdSpawn,
 * starts an AgentRunner, and blocks until terminated.
 *
 * Environment variables (all required when running detached):
 *   BRACT_HOME          - Path to bract home directory
 *   BRACT_AGENT_NAME    - Agent name
 *   BRACT_AGENT_MODEL   - Model identifier
 *   BRACT_AGENT_SYSTEM  - (optional) System prompt
 *
 * @module @losoft/bract-cli/agent-worker
 */
import { ProcessTable } from '@losoft/bract-runtime';
import { AgentRunner } from '@losoft/bract-runner';

const home = process.env.BRACT_HOME;
const name = process.env.BRACT_AGENT_NAME;
const model = process.env.BRACT_AGENT_MODEL;
const system = process.env.BRACT_AGENT_SYSTEM;

if (!home || !name || !model) {
  process.stderr.write(
    'agent-worker: BRACT_HOME, BRACT_AGENT_NAME, and BRACT_AGENT_MODEL are required\n',
  );
  process.exit(1);
}

const pt = new ProcessTable(home);
pt.setRunning(name, process.pid);

const runner = new AgentRunner({ name, home, model, system });

process.on('SIGINT', () => {
  runner.stop();
  pt.setDead(name);
  process.exit(0);
});

process.on('SIGTERM', () => {
  runner.stop();
  pt.setDead(name);
  process.exit(0);
});

await runner.start();

// Keep the process alive
await new Promise<void>(() => { /* run until signal */ });
