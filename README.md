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
$BRACT_HOME/
  agents/
    my-agent/
      pid          # current process id
      status       # running | idle | dead
      model        # model in use
      inbox/       # drop a .msg file here to send a message
      outbox/      # agent writes responses here
      memory/      # persistent key-value state
      logs/        # append-only structured log, one file per day
      crashes/     # crash records (if any)
  supervisor.pid   # supervisor process id
  pipes/           # active agent-to-agent wiring
```

---

## Getting started

### Prerequisites

- [Bun](https://bun.sh) 1.1+
- [Ollama](https://ollama.com) running locally (or any OpenAI-compatible endpoint)

### Build from source

```sh
git clone https://github.com/hiloagent/bract
cd bract
bun install
bun run build
```

### Start a single agent

```sh
# Pull a model (if using Ollama)
ollama pull qwen2.5:3b

# Start an agent
bract spawn my-agent --model qwen2.5:3b --system "You are a helpful assistant."

# Send it a message
bract send my-agent "What is the capital of France?"

# Read the response
bract read my-agent
```

### Validate a config

```sh
# Check your bract.yml is valid before using it
bract validate

# Point at a specific file
bract validate --file ./config/agents.yml

# Machine-readable output
bract validate --json
```

---

## CLI

```sh
# Fleet
bract up [--follow]              # start supervisor and all agents from bract.yml
bract down                       # stop supervisor and all agents
bract ps                         # list agents and their status

# Agents
bract spawn <name>               # start an agent from bract.yml
bract log <name> [-f]            # stream agent logs

# Messaging
bract send <name> "<message>"    # send a message to an agent's inbox
bract read <name>                # read latest outbox message(s)
bract inbox <name>               # show pending inbox messages

# Config
bract validate [--file <path>]   # validate bract.yml against schema and pipe rules
bract init                       # scaffold a starter bract.yml
```

**Coming next:** `bract pipe` / `bract pipes` — dynamic pipe wiring, `bract init` — scaffold a starter bract.yml.

---

## Why filesystem

- Any language can read a file. No SDK required to observe an agent.
- `tail -f logs/my-agent` works. `ls inbox/` works. `cat status` works.
- State survives process crashes. Inbox messages are not lost.
- Works offline. No cloud dependency. No API key required to run.
- Composable with Unix tools: `watch`, `grep`, `jq`, `cron`.

---

## Memory

Each agent has a persistent `memory/` directory. The `@losoft/bract-memory` package exposes seven tools:

| Tool | Description |
|------|-------------|
| `memory_read(key, start?, end?)` | Read a file, optionally by line range |
| `memory_write(key, content)` | Create or overwrite a file |
| `memory_append(key, content)` | Append to a file (creates if absent) |
| `memory_replace(key, old, new)` | Find-and-replace inside a file |
| `memory_grep(pattern)` | Regex search across all memory files |
| `memory_glob(pattern)` | Filename pattern matching (`*` lists all) |
| `memory_delete(key)` | Remove a file |

Memory files are injected into the agent's system prompt automatically.

---

## Pluggable models

bract routes models by prefix — Ollama (default), Anthropic, OpenAI, and OpenRouter are all supported. Any OpenAI-compatible endpoint also works:

```sh
# Local via Ollama (default — no prefix needed)
bract spawn my-agent --model qwen2.5:3b

# Explicit Ollama prefix
bract spawn my-agent --model ollama/qwen3.5:9b

# Anthropic (set ANTHROPIC_API_KEY)
ANTHROPIC_API_KEY=sk-ant-... \
bract spawn my-agent --model anthropic/claude-sonnet-4-6

# OpenAI (set OPENAI_API_KEY)
OPENAI_API_KEY=sk-... \
bract spawn my-agent --model openai/gpt-4o

# OpenRouter (set OPENROUTER_API_KEY)
OPENROUTER_API_KEY=sk-or-... \
bract spawn my-agent --model openrouter/anthropic/claude-3.5-sonnet
```

| Prefix | Provider | Env vars |
|--------|----------|----------|
| _(none)_ | Ollama | `OLLAMA_BASE_URL` (default: `http://localhost:11434/v1`) |
| `ollama/` | Ollama | `OLLAMA_BASE_URL` |
| `anthropic/` | Anthropic | `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL` |
| `openai/` | OpenAI | `OPENAI_API_KEY`, `OPENAI_BASE_URL` |
| `openrouter/` | OpenRouter | `OPENROUTER_API_KEY` |

See [`docs/adrs/ADR-006-model-routing.md`](docs/adrs/ADR-006-model-routing.md) for the full model routing spec.

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  bract supervisor (single long-running process)      │
│                                                      │
│  ┌────────────┐   ┌────────────┐   ┌─────────────┐  │
│  │ inbox      │   │ agent A    │   │ pipe engine │  │
│  │ watcher    │──▶│ (spawned)  │──▶│ (outbox →   │  │
│  │ (polling)  │   │            │   │  inbox)     │  │
│  └────────────┘   └────────────┘   └─────────────┘  │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │ health monitor (heartbeat every 5s)            │  │
│  │  → detects dead agents                         │  │
│  │  → applies restart policy with backoff         │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
                        │
                        │ reads/writes
                        ▼
┌──────────────────────────────────────────────────────┐
│  $BRACT_HOME/agents/{name}/                          │
│    pid  status  inbox/  outbox/  memory/  logs/      │
└──────────────────────────────────────────────────────┘
                        │
                        │ any process can read/write
                        ▼
              standard Unix tools
              cat, tail, grep, jq, watch
```

Each agent is a spawned child process. The supervisor watches for crashes and
restarts with exponential backoff. If the supervisor dies, agents keep running —
they just won't be restarted until the supervisor comes back.

---

## Status

Early alpha. Core messaging and agent lifecycle are working. Fleet management (supervisor, `bract up`, pipe engine, model routing) is complete. Dynamic pipe CLI and plugin hooks are next.

- [x] Filesystem layout ([ADR-001](docs/adrs/ADR-001-filesystem-as-process-table.md))
- [x] Message module (inbox/outbox read/write, consume-to-processed)
- [x] Inbox watcher (filesystem polling → agent trigger, [ADR-002](docs/adrs/ADR-002-inbox-watcher-polling.md))
- [x] AgentRunner (connects inbox → LLM → outbox, multi-provider routing)
- [x] CLI (`bract ps`, `bract spawn`, `bract send`, `bract read`, `bract inbox`, `bract validate`, `bract up`, `bract down`, `bract log`)
- [x] Memory tools (`memory_read`, `memory_write`, `memory_append`, `memory_replace`, `memory_grep`, `memory_glob`, `memory_delete`)
- [x] Memory injection (agent memory files in system prompt)
- [x] Supervisor with restart policy ([ADR-003](docs/adrs/ADR-003-supervisor-and-restart-policy.md))
- [x] `bract up` / `bract down` / `bract log` ([ADR-004](docs/adrs/ADR-004-bract-yml-fleet-config.md))
- [x] Pipe engine (wire agent outboxes together via bract.yml, [ADR-008](docs/adrs/ADR-008-pipe-engine.md))
- [x] Model routing (Ollama, Anthropic, OpenAI, OpenRouter, [ADR-006](docs/adrs/ADR-006-model-routing.md))
- [ ] Plugin hooks ([ADR-005](docs/adrs/ADR-005-plugin-model.md))

---

## Design decisions

Architecture decision records live in [`docs/adrs/`](docs/adrs/):

| ADR | Title |
|-----|-------|
| [ADR-001](docs/adrs/ADR-001-filesystem-as-process-table.md) | Filesystem as process table |
| [ADR-002](docs/adrs/ADR-002-inbox-watcher-polling.md) | Inbox watcher via polling |
| [ADR-003](docs/adrs/ADR-003-supervisor-and-restart-policy.md) | Supervisor and restart policy |
| [ADR-004](docs/adrs/ADR-004-bract-yml-fleet-config.md) | bract.yml fleet config format |
| [ADR-005](docs/adrs/ADR-005-plugin-model.md) | Plugin and extension model |
| [ADR-006](docs/adrs/ADR-006-model-routing.md) | Model routing and provider abstraction |
| [ADR-007](docs/adrs/ADR-007-memory-system.md) | Memory system — persistent files per agent |
| [ADR-008](docs/adrs/ADR-008-pipe-engine.md) | Pipe engine — outbox-to-inbox forwarding |
| [ADR-009](docs/adrs/ADR-009-dual-target-build.md) | Dual-target build (Bun + Node.js) |

---

## License

MIT
