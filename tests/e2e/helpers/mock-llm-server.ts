/**
 * @file helpers/mock-llm-server.ts
 * A minimal OpenAI-compatible chat completions server using Bun.serve.
 * Used in tier 2/3 e2e tests so agents can process messages without Ollama.
 */

export interface MockResponse {
  /** Content to return for the next matched request. */
  content: string;
  /** If set, only respond when the last user message contains this string. */
  match?: string;
}

export interface MockLLMServer {
  baseUrl: string;
  /** Queue a response — served FIFO unless match is set */
  enqueue(response: MockResponse): void;
  /** Replace all queued responses with a fixed reply */
  setFixed(content: string): void;
  /** Number of requests received so far */
  readonly requestCount: number;
  stop(): void;
}

/**
 * Start a mock OpenAI-compatible LLM server.
 * Returns immediately with the server's base URL.
 */
export async function startMockLLM(): Promise<MockLLMServer> {
  const queue: MockResponse[] = [];
  let fixed: string | null = 'OK';
  let requestCount = 0;

  const server = Bun.serve({
    port: 0, // random available port
    fetch(req) {
      if (!req.url.includes('/chat/completions')) {
        return new Response('not found', { status: 404 });
      }

      return req.json().then((body: any) => {
        requestCount++;

        const lastUserMsg: string =
          [...(body.messages ?? [])].reverse().find((m: any) => m.role === 'user')?.content ?? '';

        // Pick response: check queue for a match first, then FIFO, then fixed
        let content: string | null = null;
        const matchIdx = queue.findIndex((r) => !r.match || lastUserMsg.includes(r.match));
        if (matchIdx !== -1) {
          content = queue[matchIdx].content;
          queue.splice(matchIdx, 1);
        } else {
          content = fixed;
        }

        if (content === null) {
          return new Response(JSON.stringify({ error: 'no response queued' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const responseBody = {
          id: `mock-${requestCount}`,
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        };

        return new Response(JSON.stringify(responseBody), {
          headers: { 'Content-Type': 'application/json' },
        });
      });
    },
  });

  return {
    baseUrl: `http://localhost:${server.port}/v1`,
    enqueue(response) { queue.push(response); },
    setFixed(content) { fixed = content; },
    get requestCount() { return requestCount; },
    stop() { server.stop(true); },
  };
}
