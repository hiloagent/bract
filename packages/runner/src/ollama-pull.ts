/**
 * @file ollama-pull.ts
 * Ollama-specific helpers for checking model availability and auto-pulling
 * missing models before first inference.
 *
 * @module @losoft/bract-runner/ollama-pull
 */

/** Progress event yielded during an Ollama model pull. */
export interface OllamaPullProgress {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
}

/**
 * Derive the native Ollama API root from the OpenAI-compat base URL.
 *
 * Ollama's OpenAI-compatible endpoint lives at `/v1` (e.g. `http://localhost:11434/v1`),
 * but native endpoints like `/api/tags` and `/api/pull` sit at the root.
 */
export function ollamaApiRoot(baseUrl: string): string {
  return baseUrl.replace(/\/v1\/?$/, '');
}

/**
 * Check whether a model is available locally in Ollama via `GET /api/tags`.
 *
 * Handles the implicit `:latest` tag — requesting `llama3` matches `llama3:latest`.
 */
export async function isModelAvailable(apiRoot: string, model: string): Promise<boolean> {
  const res = await fetch(`${apiRoot}/api/tags`);
  if (!res.ok) {
    throw new Error(`ollama: failed to list models (HTTP ${res.status})`);
  }

  const data = (await res.json()) as { models?: Array<{ name: string }> };
  const models = data.models ?? [];

  const candidates = [model];
  if (!model.includes(':')) {
    candidates.push(`${model}:latest`);
  }

  return models.some((m) => candidates.includes(m.name));
}

/**
 * Pull a model from the Ollama registry via `POST /api/pull`.
 *
 * Yields {@link OllamaPullProgress} events parsed from the NDJSON response stream.
 * Throws on HTTP error or if the stream contains an error status.
 */
export async function* pullModel(apiRoot: string, model: string): AsyncGenerator<OllamaPullProgress> {
  const res = await fetch(`${apiRoot}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: model }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ollama: failed to pull model '${model}' (HTTP ${res.status}): ${text}`);
  }

  if (!res.body) {
    throw new Error(`ollama: pull response has no body`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // Keep the last (possibly incomplete) line in the buffer
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const progress = JSON.parse(trimmed) as OllamaPullProgress & { error?: string };
        if (progress.error) {
          throw new Error(`ollama: pull failed for '${model}': ${progress.error}`);
        }
        yield progress;
      }
    }

    // Process any remaining data in the buffer
    const trimmed = buffer.trim();
    if (trimmed) {
      const progress = JSON.parse(trimmed) as OllamaPullProgress & { error?: string };
      if (progress.error) {
        throw new Error(`ollama: pull failed for '${model}': ${progress.error}`);
      }
      yield progress;
    }
  } finally {
    reader.releaseLock();
  }
}
