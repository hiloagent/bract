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

- [Node.js](https://nodejs.org) 22+
- [Ollama](https://ollama.com) running locally (or an Anthropic/OpenRouter API key)

### Install

```sh
npm install -g bract
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

# Watch its log
bract log my-agent --follow
```

### Run a fleet

Create a `bract.yml` in any directory:

```yaml
version: 1

agents:
  - name: researcher
    model: qwen3.5:9b
    system: |
      You are a research assistant. When given a topic, search for recent
      developments and write a concise summary with your analysis.
    restart: always

  - name: notify
    model: qwen2.5:3b
    system: |
      You receive research summaries. Send a Telegram message with
      the key points in 3 bullet points.
    env:
      TELEGRAM_BOT_TOKEN: "${TELEGRAM_BOT_TOKEN}"
      TELEGRAM_CHAT_ID: "${TELEGRAM_CHAT_ID}"
    pipes:
      - from: researcher
```

Then:

```sh
bract up
bract ps
bract send researcher "Latest developments in fusion energy"
bract read notify --follow
```

---

## CLI

```sh
# Fleet
bract up                          # start all agents from bract.yml
bract down                        # stop all agents
bract ps                          # list agents + status

# Lifecycle
bract spawn <name> --model <m>    # start a single agent
bract kill <name>                 # stop an agent
bract restart <name>              # restart an agent

# Messaging
bract send <name> "<message>"     # send a message
bract read <name>                 # read latest outbox message
bract inbox <name>                # show pending inbox messages
bract pipe <from> <to>            # wire two agents together

# Observation
bract log <name> --follow         # stream agent logs
bract memory <name>               # read/write agent memory

# Maintenance
bract validate                    # lint bract.yml
bract gc                          # clean up old logs and processed messages
bract status                      # supervisor health
```

See [`docs/cli-spec.md`](docs/cli-spec.md) for the full command reference.

---

## Why filesystem

- Any language can read a file. No SDK required to observe an agent.
- `tail -f logs/my-agent` works. `ls inbox/` works. `cat status` works.
- State survives process crashes. Inbox messages are not lost.
- Works offline. No cloud dependency. No API key required to run.
- Composable with Unix tools: `watch`, `grep`, `jq`, `cron`.

---

## Pluggable models

```sh
# Local via Ollama (default)
bract spawn my-agent --model qwen3.5:9b

# Remote via Anthropic
ANTHROPIC_API_KEY=sk-... bract spawn my-agent --model anthropic/claude-sonnet-4-6

# Remote via OpenRouter
OPENROUTER_API_KEY=sk-... bract spawn my-agent --model openrouter/qwen/qwen-2.5-72b-instruct
```

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

## Extension

Plugins are sidecar processes or in-process hooks. The filesystem is the interface —
a plugin just reads and writes the same files an agent would.

```typescript
// bract.config.ts — register custom tools, hooks, or providers
import type { BractConfig } from 'bract'

export default {
  tools: [
    {
      name: 'web_search',
      description: 'Search the web',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query']
      },
      handler: async ({ query }) => { /* ... */ }
    }
  ],
  hooks: {
    afterMessage: async ({ agent, response }) => {
      // called after every agent response
    }
  }
} satisfies BractConfig
```

See [`docs/adrs/ADR-005-plugin-model.md`](docs/adrs/ADR-005-plugin-model.md) for details.

---

## Examples

- [`examples/research-fleet/`](examples/research-fleet/) — Four agents running a continuous research pipeline on a single GPU

---

## Status

Early design phase. Core runtime being built.

- [x] Filesystem layout ([ADR-001](docs/adrs/ADR-001-filesystem-as-process-table.md))
- [x] Message module (inbox/outbox read/write, consume-to-processed)
- [x] Inbox watcher (filesystem polling → agent trigger, [ADR-002](docs/adrs/ADR-002-inbox-watcher-polling.md))
- [ ] Agent spawner
- [ ] Supervisor with restart policy ([ADR-003](docs/adrs/ADR-003-supervisor-and-restart-policy.md))
- [ ] `bract up` / `bract down` ([ADR-004](docs/adrs/ADR-004-bract-yml-fleet-config.md))
- [ ] CLI (`bract ps`, `bract spawn`, `bract send`, `bract log`, `bract read`)
- [ ] Pipe engine (wire agent outboxes together)
- [ ] Memory (persistent key-value per agent)
- [ ] Model routing (Ollama + Anthropic + OpenRouter, [ADR-006](docs/adrs/ADR-006-model-routing.md))
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

---

## License

MIT
