# Quickstart

The fastest way to run a local AI agent with bract.

## Prerequisites

- [Bun](https://bun.sh) 1.1+
- [Ollama](https://ollama.com) running locally

## Steps

**1. Pull a model**

```sh
ollama pull qwen2.5:3b
```

**2. Build bract from the repo root**

```sh
bun install && bun run build
```

**3. Go to this directory and validate the config**

```sh
cd examples/quickstart
bract validate
# ✓ bract.yml is valid (1 agent, 0 pipes)
```

**4. Spawn the agent**

```sh
bract spawn assistant
# ✓ spawned assistant (qwen2.5:3b)
```

**5. Send a message**

```sh
bract send assistant "What is the tallest mountain on Earth?"
```

**6. Read the reply**

```sh
bract read assistant
# Mount Everest, at 8,849 metres above sea level, is the tallest mountain on Earth.
```

**7. Check agent status**

```sh
bract ps
# NAME         STATUS    MODEL
# assistant    running   qwen2.5:3b
```

## What's happening

Each `bract send` writes a `.msg` file into `~/.bract/agents/assistant/inbox/`.
The agent's inbox watcher picks it up, calls Ollama, and writes the reply to
`~/.bract/agents/assistant/outbox/`. `bract read` prints the latest outbox file.

Everything is plain files — you can inspect the state with standard Unix tools:

```sh
ls ~/.bract/agents/assistant/inbox/
ls ~/.bract/agents/assistant/outbox/
cat ~/.bract/agents/assistant/outbox/*.msg
```

## Use a different model

Edit `bract.yml` and change the `model` field to any model you have in Ollama:

```sh
ollama list
```

Or point at any OpenAI-compatible endpoint:

```sh
BRACT_BASE_URL=https://api.openai.com/v1 OPENAI_API_KEY=sk-... bract spawn assistant
```
