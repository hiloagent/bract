/**
 * Mock LLM server — responds to OpenAI-compatible /chat/completions requests.
 * Uses Bun.serve on port 0 (random) so tests don't conflict.
 */

export interface MockResponse {
  content: string;
  /** If set, only respond when request body contains this string. */
  match?: string;
}

export interface MockLLMServer {
  baseUrl: string;
  /** Queue a response for the next matching request. */
  enqueue(resp: MockResponse): void;
  /** Set a fixed response for all requests (overrides queue). */
  setFixed(content: string | null): void;
  /** Total requests received so far. */
  readonly requestCount: number;
  stop(): void;
}

function makeChoice(content: string) {
  return {
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop', index: 0 }],
    model: 'mock',
    object: 'chat.completion',
    id: `mock-${Date.now()}`,
    created: Math.floor(Date.now() / 1000),
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  };
}

export function startMockLLM(): MockLLMServer {
  const queue: MockResponse[] = [];
  let fixed: string | null = null;
  let count = 0;

  const server = Bun.serve({
    port: 0, // random available port
    async fetch(req) {
      const url = new URL(req.url);

      // Health check
      if (url.pathname === '/health') {
        return new Response('ok');
      }

      // Ollama model availability check — report all models as available
      if (url.pathname === '/api/tags') {
        return Response.json({ models: [{ name: 'test-model:latest' }] });
      }

      if (url.pathname !== '/v1/chat/completions') {
        return new Response('not found', { status: 404 });
      }

      count++;
      const body = await req.text();

      // Queue takes priority over fixed — allows test to override for specific requests
      for (let i = 0; i < queue.length; i++) {
        const entry = queue[i];
        if (!entry.match || body.includes(entry.match)) {
          queue.splice(i, 1);
          return Response.json(makeChoice(entry.content));
        }
      }

      // Fixed response for all remaining requests
      if (fixed !== null) {
        return Response.json(makeChoice(fixed));
      }

      // Default fallback
      return Response.json(makeChoice('mock response'));
    },
  });

  const port = server.port;
  const baseUrl = `http://localhost:${port}/v1`;

  return {
    baseUrl,
    enqueue(resp: MockResponse) { queue.push(resp); },
    setFixed(content: string | null) { fixed = content; },
    get requestCount() { return count; },
    stop() { server.stop(true); },
  };
}
