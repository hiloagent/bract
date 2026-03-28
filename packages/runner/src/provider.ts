/**
 * @file provider.ts
 * Provider interface and model string resolver for ADR-006 model routing.
 *
 * Model string format:
 *   qwen2.5:3b                         — Ollama (default, no prefix)
 *   ollama/qwen3.5:9b                  — Ollama (explicit)
 *   anthropic/claude-sonnet-4-6        — Anthropic native API
 *   openai/gpt-4o                      — OpenAI
 *   openrouter/anthropic/claude-3.5    — OpenRouter
 *
 * @module @losoft/bract-runner/provider
 */

/** A single chat message. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** The result of a chat call. */
export interface ChatResult {
  /** Assistant reply text. */
  content: string;
  /** Token usage if the provider reports it. */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/** Minimal interface every provider must implement. */
export interface Provider {
  /** Human-readable provider name, e.g. "ollama", "anthropic". */
  readonly name: string;
  /** Send a chat request and return the assistant reply. */
  chat(model: string, messages: ChatMessage[]): Promise<ChatResult>;
}

/** Registry of available providers. */
export interface ProviderRegistry {
  ollama: Provider;
  anthropic: Provider;
  openai: Provider;
  openrouter: Provider;
}

/** Resolved provider + bare model name after stripping the prefix. */
export interface ProviderResolution {
  provider: Provider;
  /** Model name after stripping the prefix, e.g. "claude-sonnet-4-6". */
  modelName: string;
}

/**
 * Parse a model string and return the matching provider + bare model name.
 *
 * @example
 * resolveProvider('anthropic/claude-sonnet-4-6', registry)
 * // { provider: anthropicProvider, modelName: 'claude-sonnet-4-6' }
 */
export function resolveProvider(model: string, registry: ProviderRegistry): ProviderResolution {
  if (model.startsWith('anthropic/')) {
    return { provider: registry.anthropic, modelName: model.slice('anthropic/'.length) };
  }
  if (model.startsWith('openai/')) {
    return { provider: registry.openai, modelName: model.slice('openai/'.length) };
  }
  if (model.startsWith('openrouter/')) {
    return { provider: registry.openrouter, modelName: model.slice('openrouter/'.length) };
  }
  if (model.startsWith('ollama/')) {
    return { provider: registry.ollama, modelName: model.slice('ollama/'.length) };
  }
  // Default: Ollama (no prefix)
  return { provider: registry.ollama, modelName: model };
}
