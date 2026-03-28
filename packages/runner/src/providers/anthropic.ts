/**
 * @file providers/anthropic.ts
 * Anthropic native API provider — uses the Messages API directly via fetch.
 *
 * Does not depend on the Anthropic SDK — uses only Bun's built-in fetch so
 * the runner package stays dependency-free.
 *
 * @module @losoft/bract-runner/providers/anthropic
 */
import type { Provider, ChatMessage, ChatResult } from '../provider.js';

/** Anthropic API version header value. */
const ANTHROPIC_VERSION = '2023-06-01';

export interface AnthropicProviderOptions {
  /** Anthropic API key. */
  apiKey: string;
  /** Base URL (default: https://api.anthropic.com). */
  baseUrl?: string;
}

/** Anthropic-shaped message (system is a top-level field, not a role). */
interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Provider for Anthropic's Messages API.
 * Separates the system prompt from the messages array as required by Anthropic.
 */
export class AnthropicProvider implements Provider {
  readonly name = 'anthropic';
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts: AnthropicProviderOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '');
  }

  async chat(model: string, messages: ChatMessage[]): Promise<ChatResult> {
    if (!this.apiKey) {
      throw new Error('anthropic: ANTHROPIC_API_KEY is not set');
    }

    // Anthropic requires system as a top-level field, not a message role.
    let system: string | undefined;
    const anthropicMessages: AnthropicMessage[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        // Accumulate system messages (usually only one, but be safe).
        system = system ? `${system}\n\n${msg.content}` : msg.content;
      } else {
        anthropicMessages.push({ role: msg.role, content: msg.content });
      }
    }

    if (anthropicMessages.length === 0) {
      throw new Error('anthropic: at least one non-system message is required');
    }

    const body: Record<string, unknown> = {
      model,
      max_tokens: 8192,
      messages: anthropicMessages,
    };
    if (system) body.system = system;

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`anthropic API error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage?: { input_tokens: number; output_tokens: number };
    };

    const textBlock = data.content?.find((b) => b.type === 'text');
    const content = textBlock?.text;
    if (!content) throw new Error('anthropic returned empty response');

    const result: ChatResult = { content };
    if (data.usage) {
      result.usage = {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
      };
    }
    return result;
  }
}
