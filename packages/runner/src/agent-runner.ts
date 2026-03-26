/**
 * @file agent-runner.ts
 * AgentRunner — connects an agent inbox to a language model via OpenAI-compatible API.
 *
 * Reads incoming messages from the agent inbox directory, calls the configured
 * model endpoint (Ollama by default), and writes the response to the outbox.
 * Only one message is processed at a time — the inbox watcher is paused during
 * inference and resumed immediately after, preventing queue pile-up.
 *
 * @module @losoft/bract-runner/agent-runner
 */
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { InboxWatcher, reply, type MessageEvent } from '@losoft/bract-runtime';

export interface AgentRunnerOptions {
  /** Agent name — must match the directory under $BRACT_HOME/agents/ */
  name: string;
  /** BRACT_HOME path */
  home: string;
  /** Model ID, e.g. "qwen2.5:7b" or "deepseek-r1:14b" */
  model: string;
  /** OpenAI-compatible base URL. Default: http://localhost:11434/v1 */
  baseUrl?: string;
  /** System prompt for the agent */
  system?: string;
  /** Poll interval in ms. Default: 200 */
  pollIntervalMs?: number;
  /**
   * Maximum number of history message objects to include in each API call.
   * Each completed turn adds two entries (user + assistant). When the limit
   * is exceeded the oldest entries are dropped. Default: 0 (stateless).
   */
  maxHistory?: number;
}

export interface RunEvent {
  agentName: string;
  messageId: string;
  reply: string;
  durationMs: number;
}

export interface RunErrorEvent {
  agentName: string;
  messageId: string;
  error: unknown;
}

type HistoryEntry = { role: string; content: string };

/**
 * AgentRunner wires an agent's inbox to a local (Ollama) language model.
 *
 * For each incoming message it calls the model and writes the reply to
 * the agent's outbox. One message is processed at a time — the watcher
 * pauses during inference and resumes immediately after.
 *
 * @example
 * ```ts
 * const runner = new AgentRunner({
 *   name: 'summariser',
 *   home: process.env.BRACT_HOME!,
 *   model: 'qwen2.5:7b',
 *   system: 'You summarise text concisely.',
 *   maxHistory: 20,
 * });
 *
 * runner.on('run', ({ reply, durationMs }) => {
 *   console.log(`[${durationMs}ms] ${reply}`);
 * });
 *
 * await runner.start();
 * ```
 */
export class AgentRunner extends EventEmitter {
  private readonly opts: Required<AgentRunnerOptions>;
  private readonly watcher: InboxWatcher;
  private running = false;
  /** In-memory conversation history. Cleared on restart. */
  private readonly history: HistoryEntry[] = [];

  constructor(options: AgentRunnerOptions) {
    super();
    this.opts = {
      baseUrl: 'http://localhost:11434/v1',
      system: '',
      pollIntervalMs: 200,
      maxHistory: 0,
      ...options,
    };

    const agentsRoot = join(this.opts.home, 'agents');
    this.watcher = InboxWatcher.forAgent(agentsRoot, this.opts.name, {
      pollIntervalMs: this.opts.pollIntervalMs,
    });

    this.watcher.on('message', (event: MessageEvent) => {
      void this.handleMessage(event);
    });

    this.watcher.on('error', (event) => {
      this.emit('error', event);
    });
  }

  /** Start the inbox watcher. Returns when the runner is active. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.watcher.start();
  }

  /** Stop the inbox watcher. */
  stop(): void {
    this.running = false;
    this.watcher.stop();
  }

  private async handleMessage(event: MessageEvent): Promise<void> {
    // Pause while we process — no parallel inference.
    this.watcher.stop();

    const { agentName, message } = event;
    const outboxDir = join(this.opts.home, 'agents', agentName, 'outbox');
    const t0 = Date.now();

    try {
      const responseText = await this.callModel(message.body);
      await reply(outboxDir, agentName, responseText, { replyTo: message.id });

      this.appendHistory(message.body, responseText);

      const runEvent: RunEvent = {
        agentName,
        messageId: message.id,
        reply: responseText,
        durationMs: Date.now() - t0,
      };
      this.emit('run', runEvent);
    } catch (err) {
      const errEvent: RunErrorEvent = {
        agentName,
        messageId: message.id,
        error: err,
      };
      this.emit('run:error', errEvent);
    } finally {
      if (this.running) this.watcher.start();
    }
  }

  /** Append a completed turn to history and trim to maxHistory. */
  private appendHistory(userContent: string, assistantContent: string): void {
    if (this.opts.maxHistory <= 0) return;
    this.history.push({ role: 'user', content: userContent });
    this.history.push({ role: 'assistant', content: assistantContent });
    while (this.history.length > this.opts.maxHistory) {
      this.history.shift();
    }
  }

  private async callModel(prompt: string): Promise<string> {
    const messages: HistoryEntry[] = [];

    if (this.opts.system) {
      messages.push({ role: 'system', content: this.opts.system });
    }

    // Include conversation history (empty when maxHistory=0).
    messages.push(...this.history);

    messages.push({ role: 'user', content: prompt });

    const response = await fetch(`${this.opts.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.opts.model, messages, stream: false }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Model API error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Model returned empty response');
    return content;
  }
}
