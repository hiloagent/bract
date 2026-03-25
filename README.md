# bract

> The leaf that wraps a flower before it opens — scaffolding that enables growth, then disappears.

A local-first agent runtime. Agents are processes. All state lives in the filesystem. Nothing is hidden.

---

## The problem with agent frameworks

Most frameworks treat agents as function calls: input goes in, output comes out, nothing persists. They optimise for demos. When something goes wrong at 3am, there is no process table to inspect, no filesystem to read, no way to understand what happened.

bract does the opposite.

## Core idea

An agent is a long-running process. It has an identity, a working directory, an inbox, and an outbox. Agents communicate by writing files. The supervisor watches them and restarts on crash. You can observe everything with standard Unix tools.

```
/var/bract/
  agents/
    my-agent/
      pid          # current process id
      status       # running | idle | dead
      inbox/       # drop a .msg file here to send a message
      outbox/      # agent writes responses here
      memory/      # persistent key-value state
      logs/        # append-only structured log
  supervisor.pid   # supervisor process id
```

## CLI

```sh
bract spawn my-agent --model qwen3.5:9b   # start an agent
bract ps                                   # list all agents + status
bract send my-agent "hello"               # send a message
bract log my-agent                        # tail the agent log
bract kill my-agent                       # stop an agent
bract pipe agent-a agent-b               # wire outbox of A to inbox of B
```

## Why filesystem

- Any language can read a file. No SDK required to observe an agent.
- `tail -f logs/my-agent` works. `ls inbox/` works. `cat status` works.
- State survives process crashes. Inbox messages are not lost.
- Works offline. No cloud dependency. No API key required to run.
- Composable with Unix tools: `watch`, `grep`, `jq`, `cron`.

## Pluggable models

```sh
# Local via Ollama (default)
BRACT_MODEL=qwen3.5:9b bract spawn my-agent

# Remote via Anthropic
ANTHROPIC_API_KEY=sk-... BRACT_MODEL=claude-sonnet-4-6 bract spawn my-agent

# Remote via OpenRouter
ANTHROPIC_BASE_URL=https://openrouter.ai/api BRACT_MODEL=qwen/qwen-2.5-72b-instruct bract spawn my-agent
```

## Status

Early design phase. Core runtime being built.

- [x] Process table (filesystem layout)
- [x] Message module (inbox/outbox read/write, consume-to-processed)
- [x] Inbox watcher (filesystem polling → agent trigger)
- [ ] Agent spawner
- [ ] Supervisor (crash detection + restart)
- [ ] CLI (`bract ps`, `bract spawn`, `bract send`, `bract log`)
- [ ] Pipe (wire agent outboxes together)
- [ ] Memory (persistent key-value per agent)

## Design decisions

See [`docs/adrs/`](docs/adrs/) for architecture decision records.

## License

MIT
