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

/**
 * Run a detached agent worker.
 * Called by the CLI when spawned with the __worker sentinel.
 */
export async function runWorker(): Promise<void> {
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

  // Reffed timer prevents the event loop from exiting in compiled Bun SFEs.
  // Without this, InboxWatcher's unref()'d timer is the only scheduled work,
  // and the process exits immediately after runner.start() returns.
  const keepAlive = setInterval(() => {}, 2_147_483_647);

  // Cleanup function for graceful shutdown on signals.
  const cleanupAndExit = () => {
    clearInterval(keepAlive);
    runner.stop();
    pt.setDead(name);
    process.exit(0);
  };

  process.once('SIGINT', cleanupAndExit);
  process.once('SIGTERM', cleanupAndExit);

  await runner.start();

  // Block until signal; keepAlive timer above holds the event loop open.
  await new Promise<void>(() => { /* run until signal */ });
}
