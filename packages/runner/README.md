# @losoft/bract-runner

Agent runner for [bract](https://github.com/hiloagent/bract). Connects an agent's inbox to any OpenAI-compatible language model, processes messages one at a time, and writes replies to the outbox.

## Install

```bash
npm install @losoft/bract-runner
# or
bun add @losoft/bract-runner
```

## Usage

```ts
import { AgentRunner } from '@losoft/bract-runner';

const runner = new AgentRunner({
  name: 'assistant',
  home: '/home/user/.bract',
  model: 'qwen2.5:7b',

  // OpenAI-compatible endpoint — defaults to Ollama at localhost:11434
  baseUrl: 'http://localhost:11434/v1',

  // Optional system prompt
  system: 'You are a concise assistant. Keep answers under 3 sentences.',

  // Conversation history depth (user+assistant pairs). Default: 20
  historyLimit: 20,

  // Memory injection from $BRACT_HOME/agents/<name>/memory/
  memory: {
    inject: 'all',       // 'all' | 'none' | ['file1.md', 'file2.md']
    injectLimitKb: 2,    // per-file truncation limit
  },
});

runner.on('run', ({ agentName, messageId, reply }) => {
  console.log(`[${agentName}] replied to ${messageId}: ${reply}`);
});

runner.on('error', ({ agentName, messageId, error }) => {
  console.error(`[${agentName}] error processing ${messageId}:`, error);
});

await runner.start();

// Stop gracefully
runner.stop();
```

## How it works

1. Watches the agent's inbox (`$BRACT_HOME/agents/<name>/inbox/`) for new messages
2. Pauses the watcher, processes exactly one message at a time
3. Calls the model with the full conversation history + system prompt
4. Writes the reply to the outbox (`$BRACT_HOME/agents/<name>/outbox/`)
5. Resumes the watcher

This single-message-at-a-time model prevents queue pile-up during slow inference.

## Using with OpenAI or other providers

```ts
const runner = new AgentRunner({
  name: 'assistant',
  home: '/home/user/.bract',
  model: 'gpt-4o-mini',
  baseUrl: 'https://api.openai.com/v1',
  // set OPENAI_API_KEY in environment or pass via apiKey option
});
```

Any OpenAI-compatible API works: OpenAI, Anthropic (via compatibility layer), Together, Groq, etc.

## License

MIT
