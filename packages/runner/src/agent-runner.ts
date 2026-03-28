/**
 * @file agent-runner.ts
 * AgentRunner — connects an agent inbox to a language model via the provider abstraction.
 *
 * Reads incoming messages from the agent inbox directory, routes them to the
 * appropriate model provider (Ollama, Anthropic, OpenAI, OpenRouter) based on
 * the model string prefix, and writes the response to the outbox.
 *
 * Only one message is processed at a time — the inbox watcher is paused during
 * inference and resumed immediately after, preventing queue pile-up.
 *
 * @module @losoft/bract-runner/agent-runner
 */
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { InboxWatcher, reply, type MessageEvent } from '@losoft/bract-runtime';
import { resolveProvider } from './provider.js';
import type { ProviderRegistry, ChatMessage } from './provider.js';
import { OpenAICompatProvider } from './providers/openai-compat.js';
import { AnthropicProvider } from './providers/anthropic.js';

/** Memory injection configuration. */
export interface MemoryConfig {
  /**
   * Which files to inject: 'all' reads every file in memory/, an array
   * selects specific filenames, 'none' disables injection.
   */
  inject: 'all' | 'none' | string[];
  /** Per-file truncation limit in KB. Default: 2 */
  injectLimitKb?: number;
  /** Total injection budget in KB. Default: 16 */
  injectTotalKb?: number;
}

export interface AgentRunnerOptions {
  /** Agent name — must match the directory under $BRACT_HOME/agents/ */
  name: string;
  /** BRACT_HOME path */
  home: string;
  /** Model ID, e.g. "qwen2.5:7b", "anthropic/claude-sonnet-4-6", "openai/gpt-4o" */
  model: string;
  /**
   * Override base URL for the default Ollama provider.
   * Only used when the model has no prefix (Ollama default).
   * @default http://localhost:11434/v1
   */
  baseUrl?: string;
  /**
   * Custom provider registry. When provided, replaces the default environment-
   * based registry entirely. Useful for testing or advanced configuration.
   */
  providers?: ProviderRegistry;
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
  /** Memory injection configuration. Omit to disable memory injection. */
  memory?: MemoryConfig;
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

/** Cached memory file entry. */
interface MemoryCacheEntry {
  mtime: number;
  content: string;
}

/**
 * AgentRunner wires an agent's inbox to a language model via the provider abstraction.
 *
 * For each incoming message it routes to the appropriate provider (Ollama, Anthropic,
 * OpenAI, or OpenRouter) based on the model string prefix, and writes the reply to
 * the agent's outbox. One message is processed at a time — the watcher pauses during
 * inference and resumes immediately after.
 *
 * @example
 * ```ts
 * // Ollama (default)
 * const runner = new AgentRunner({
 *   name: 'summariser',
 *   home: process.env.BRACT_HOME!,
 *   model: 'qwen2.5:7b',
 *   system: 'You summarise text concisely.',
 * });
 *
 * // Anthropic (set ANTHROPIC_API_KEY env var)
 * const runner = new AgentRunner({
 *   name: 'researcher',
 *   home: process.env.BRACT_HOME!,
 *   model: 'anthropic/claude-sonnet-4-6',
 *   system: 'You are a research assistant.',
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
  /** mtime-keyed cache for memory files. */
  private readonly memoryCache = new Map<string, MemoryCacheEntry>();
  /** Provider registry used to route model strings. */
  private readonly providerRegistry: ProviderRegistry;

  constructor(options: AgentRunnerOptions) {
    super();
    this.opts = {
      baseUrl: 'http://localhost:11434/v1',
      providers: undefined as unknown as ProviderRegistry,
      system: '',
      pollIntervalMs: 200,
      maxHistory: 0,
      memory: undefined as unknown as Required<AgentRunnerOptions>['memory'],
      ...options,
    };

    // Build provider registry — caller can supply a custom one (useful for tests).
    this.providerRegistry = options.providers ?? this.buildDefaultRegistry();

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

  /** Build the default provider registry from environment variables. */
  private buildDefaultRegistry(): ProviderRegistry {
    return {
      ollama: new OpenAICompatProvider({
        name: 'ollama',
        baseUrl: this.opts.baseUrl,
      }),
      anthropic: new AnthropicProvider({
        apiKey: process.env.ANTHROPIC_API_KEY ?? '',
        baseUrl: process.env.ANTHROPIC_BASE_URL,
      }),
      openai: new OpenAICompatProvider({
        name: 'openai',
        baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
        apiKey: process.env.OPENAI_API_KEY,
      }),
      openrouter: new OpenAICompatProvider({
        name: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: process.env.OPENROUTER_API_KEY,
      }),
    };
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

  /**
   * Load and format memory files for injection into the system prompt.
   * Uses mtime caching — files are only re-read when their mtime changes.
   */
  private async loadMemoryContext(): Promise<string> {
    const cfg = this.opts.memory;
    if (!cfg || cfg.inject === 'none') return '';

    const limitBytes = (cfg.injectLimitKb ?? 2) * 1024;
    const totalBudgetBytes = (cfg.injectTotalKb ?? 16) * 1024;
    const memDir = join(this.opts.home, 'agents', this.opts.name, 'memory');

    // Determine which filenames to include
    let filenames: string[];
    if (cfg.inject === 'all') {
      try {
        filenames = (await readdir(memDir)).sort();
      } catch {
        return '';
      }
    } else {
      filenames = cfg.inject;
    }

    const blocks: string[] = [];
    let totalBytes = 0;

    for (const filename of filenames) {
      if (totalBytes >= totalBudgetBytes) break;

      const filePath = join(memDir, filename);

      // Check mtime for cache invalidation
      let mtime: number;
      try {
        const s = await stat(filePath);
        mtime = s.mtimeMs;
      } catch {
        // File missing — skip silently
        continue;
      }

      // Use cache if mtime unchanged
      let content: string;
      const cached = this.memoryCache.get(filename);
      if (cached && cached.mtime === mtime) {
        content = cached.content;
      } else {
        content = await Bun.file(filePath).text();
        this.memoryCache.set(filename, { mtime, content });
      }

      // Per-file truncation
      let injected = content;
      if (Buffer.byteLength(content, 'utf8') > limitBytes) {
        injected = content.slice(0, limitBytes) + '\n[... truncated ...]';
      }

      // Total budget: check remaining budget
      const injectedBytes = Buffer.byteLength(injected, 'utf8');
      const remaining = totalBudgetBytes - totalBytes;
      if (injectedBytes > remaining) {
        injected = injected.slice(0, remaining) + '\n[... truncated ...]';
      }

      totalBytes += Buffer.byteLength(injected, 'utf8');
      blocks.push(`[Memory — ${filename}]\n${injected}`);
    }

    return blocks.join('\n\n');
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
    const messages: ChatMessage[] = [];

    // Build system prompt with optional memory injection
    const memoryContext = await this.loadMemoryContext();
    const systemContent = memoryContext
      ? this.opts.system
        ? `${this.opts.system}\n\n${memoryContext}`
        : memoryContext
      : this.opts.system;

    if (systemContent) {
      messages.push({ role: 'system', content: systemContent });
    }

    // Include conversation history (empty when maxHistory=0).
    for (const h of this.history) {
      messages.push({ role: h.role as 'user' | 'assistant', content: h.content });
    }

    messages.push({ role: 'user', content: prompt });

    // Route to the appropriate provider based on model string prefix.
    const { provider, modelName } = resolveProvider(this.opts.model, this.providerRegistry);
    const result = await provider.chat(modelName, messages);
    return result.content;
  }
}
