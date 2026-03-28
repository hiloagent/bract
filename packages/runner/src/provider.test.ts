/**
 * @file provider.test.ts
 * Tests for resolveProvider — model string parsing and provider resolution.
 */
import { describe, it, expect } from 'bun:test';
import { resolveProvider } from './provider.js';
import type { Provider, ProviderRegistry, ChatMessage, ChatResult } from './provider.js';

/** Stub provider that records calls. */
function stubProvider(name: string): Provider {
  return {
    name,
    async chat(_model: string, _messages: ChatMessage[]): Promise<ChatResult> {
      return { content: `stub:${name}` };
    },
  };
}

const registry: ProviderRegistry = {
  ollama: stubProvider('ollama'),
  anthropic: stubProvider('anthropic'),
  openai: stubProvider('openai'),
  openrouter: stubProvider('openrouter'),
};

describe('resolveProvider', () => {
  it('routes "anthropic/…" to the anthropic provider', () => {
    const { provider, modelName } = resolveProvider('anthropic/claude-sonnet-4-6', registry);
    expect(provider.name).toBe('anthropic');
    expect(modelName).toBe('claude-sonnet-4-6');
  });

  it('routes "openai/…" to the openai provider', () => {
    const { provider, modelName } = resolveProvider('openai/gpt-4o', registry);
    expect(provider.name).toBe('openai');
    expect(modelName).toBe('gpt-4o');
  });

  it('routes "openrouter/…" to the openrouter provider and preserves the rest', () => {
    const { provider, modelName } = resolveProvider(
      'openrouter/anthropic/claude-3.5-sonnet',
      registry,
    );
    expect(provider.name).toBe('openrouter');
    expect(modelName).toBe('anthropic/claude-3.5-sonnet');
  });

  it('routes "ollama/…" to the ollama provider', () => {
    const { provider, modelName } = resolveProvider('ollama/qwen3.5:9b', registry);
    expect(provider.name).toBe('ollama');
    expect(modelName).toBe('qwen3.5:9b');
  });

  it('routes bare model strings (no prefix) to ollama by default', () => {
    const { provider, modelName } = resolveProvider('qwen2.5:3b', registry);
    expect(provider.name).toBe('ollama');
    expect(modelName).toBe('qwen2.5:3b');
  });

  it('handles bare model with colon and number (Ollama tag format)', () => {
    const { provider, modelName } = resolveProvider('deepseek-r1:14b', registry);
    expect(provider.name).toBe('ollama');
    expect(modelName).toBe('deepseek-r1:14b');
  });

  it('handles anthropic with haiku model', () => {
    const { provider, modelName } = resolveProvider('anthropic/claude-haiku-4-5', registry);
    expect(provider.name).toBe('anthropic');
    expect(modelName).toBe('claude-haiku-4-5');
  });

  it('handles openrouter with short model id', () => {
    const { provider, modelName } = resolveProvider('openrouter/qwen/qwen-2.5-72b', registry);
    expect(provider.name).toBe('openrouter');
    expect(modelName).toBe('qwen/qwen-2.5-72b');
  });
});
