/**
 * @file providers/openai-compat.ts
 * OpenAI-compatible provider — handles Ollama, OpenAI, and OpenRouter.
 *
 * All three use the same `/chat/completions` endpoint shape; they differ only
 * in base URL and authentication header.
 *
 * @module @losoft/bract-runner/providers/openai-compat
 */
import type { Provider, ChatMessage, ChatResult } from '../provider.js';

export interface OpenAICompatOptions {
  /** Provider name for logging. */
  name: string;
  /** Base URL including path prefix, e.g. "http://localhost:11434/v1". */
  baseUrl: string;
  /** Bearer token for Authorization header. Omit for unauthenticated (Ollama default). */
  apiKey?: string;
}

/**
 * Provider for any OpenAI-compatible `/chat/completions` endpoint.
 * Works with Ollama, OpenAI, and OpenRouter out of the box.
 */
export class OpenAICompatProvider implements Provider {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;

  constructor(opts: OpenAICompatOptions) {
    this.name = opts.name;
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.apiKey = opts.apiKey;
  }

  async chat(model: string, messages: ChatMessage[]): Promise<ChatResult> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, messages, stream: false }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${this.name} API error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens: number; completion_tokens: number };
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error(`${this.name} returned empty response`);

    const result: ChatResult = { content };
    if (data.usage) {
      result.usage = {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
      };
    }
    return result;
  }
}
