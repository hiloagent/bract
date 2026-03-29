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
 *   BRACT_AGENT_SYSTEM   - (optional) System prompt
 *   BRACT_AGENT_BASE_URL - (optional) OpenAI-compatible base URL override
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
  const baseUrl = process.env.BRACT_AGENT_BASE_URL;

  if (!home || !name || !model) {
    process.stderr.write(
      'agent-worker: BRACT_HOME, BRACT_AGENT_NAME, and BRACT_AGENT_MODEL are required\n',
    );
    process.exit(1);
  }

  const pt = new ProcessTable(home);
  pt.setRunning(name, process.pid);

  const runner = new AgentRunner({ name, home, model, system, ...(baseUrl ? { baseUrl } : {}) });

  const ts = () => new Date().toISOString();
  process.stdout.write(`[${ts()}] [${name}] started — model: ${model}\n`);

  let lastPct = -1;
  runner.on('pull:progress', (evt) => {
    if (evt.completed && evt.total) {
      const pct = Math.floor((evt.completed / evt.total) * 100);
      if (pct === lastPct) return;
      lastPct = pct;
      if (pct % 25 === 0) {
        process.stderr.write(`[${name}] pulling ${evt.model}: ${pct}%\n`);
      }
    } else {
      lastPct = -1;
      process.stderr.write(`[${name}] pulling ${evt.model}: ${evt.status}\n`);
    }
  });

  runner.on('message', ({ message }: { message: { id: string } }) => {
    process.stdout.write(`[${ts()}] [${name}] ← received message ${message.id}\n`);
  });

  runner.on('run', ({ messageId, durationMs }: { messageId: string; durationMs: number }) => {
    process.stdout.write(`[${ts()}] [${name}] ✓ replied to ${messageId} (${durationMs}ms)\n`);
  });

  runner.on('run:error', ({ messageId, error }: { messageId: string; error: unknown }) => {
    const msg = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[${ts()}] [${name}] ✗ error on ${messageId}: ${msg}\n`);
  });

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
