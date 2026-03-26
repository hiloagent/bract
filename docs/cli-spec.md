# bract CLI — command reference

This document specifies the full CLI interface for `bract`. It is a design
document, not generated output — it describes the intended behaviour.

---

## Global flags

```
bract [flags] <command> [args]

--home <path>     Override BRACT_HOME (default: ~/.bract)
--config <path>   Override config file (default: ./bract.yml)
--quiet           Suppress non-essential output
--json            Machine-readable output (where supported)
```

---

## Fleet commands

### `bract up`

Start all agents defined in `bract.yml`. Idempotent — safe to run repeatedly.

```sh
bract up
bract up --config ./my-fleet.yml
bract up --detach   # start in background, return immediately
```

Behaviour:
- Parses `bract.yml` from the current directory (or `--config`)
- For each agent:
  - If not running: spawn it
  - If running with same config hash: skip
  - If running with changed config: restart
- Starts the supervisor if not already running
- Blocks until all agents are `running` or `idle`, then exits
- With `--detach`: returns immediately after starting; use `bract ps` to monitor

Output:
```
✓ supervisor  already running (pid 12345)
✓ news-monitor  started (pid 12346, qwen2.5:3b)
~ inbox-triage  restarted (config changed)
✓ deep-researcher  already running (pid 12348)
```

### `bract down`

Stop all agents defined in `bract.yml`. Preserves state (inbox, memory, logs).

```sh
bract down
bract down --purge   # also delete agent state directories
```

### `bract restart [name]`

Restart one or all agents.

```sh
bract restart                 # restart all agents
bract restart news-monitor    # restart one agent
bract restart --force         # restart even if config unchanged
```

---

## Agent lifecycle

### `bract spawn <name>`

Start a single agent (without a `bract.yml`).

```sh
bract spawn my-agent --model qwen3.5:9b
bract spawn my-agent --model anthropic/claude-sonnet-4-6 \
  --system "You are a research assistant."
```

Flags:
```
--model <string>     Model identifier (required)
--system <string>    System prompt
--restart <policy>   always | on-failure | never (default: always)
--env KEY=VALUE      Environment variable (repeatable)
```

### `bract kill <name>`

Stop a running agent.

```sh
bract kill my-agent
bract kill my-agent --signal SIGTERM   # default
bract kill my-agent --signal SIGKILL   # force
```

---

## Observation

### `bract ps`

List all agents and their status.

```sh
bract ps
bract ps --watch   # refresh every 2s (like watch bract ps)
bract ps --json    # machine-readable
```

Output:
```
NAME              STATUS    MODEL                   RESTARTS  UPTIME   LAST MSG
news-monitor      idle      qwen2.5:3b              0         2h       14m ago
inbox-triage      running   qwen2.5:3b              0         2h       now
deep-researcher   idle      qwen3.5:9b              0         2h       1h ago
notify            idle      qwen2.5:3b              0         2h       3h ago
```

Status values:
- `running` — currently processing a message
- `idle` — alive, waiting for messages
- `restarting` — supervisor is restarting after crash
- `dead` — max restarts exceeded, needs manual intervention
- `stopped` — cleanly stopped (via `bract kill`)

### `bract log <name>`

Stream an agent's log.

```sh
bract log news-monitor                 # today's log
bract log news-monitor --follow        # tail -f equivalent
bract log news-monitor --since 1h     # last hour
bract log news-monitor --date 2026-03-24   # specific day
bract log news-monitor --json          # raw NDJSON (don't pretty-print)
```

Log entries are pretty-printed by default:
```
05:00:00.123 [news-monitor] received message from cron
05:00:00.456 [news-monitor] calling qwen2.5:3b (234 tokens)
05:00:02.891 [news-monitor] response complete (189 tokens, 2.4s)
05:00:02.892 [news-monitor] wrote outbox/1742900000000-01HX.msg
05:00:02.893 [news-monitor] status: idle
```

### `bract inbox <name>`

Show pending messages in an agent's inbox.

```sh
bract inbox news-monitor           # list pending messages
bract inbox news-monitor --all     # include processed messages
```

Output:
```
PENDING MESSAGES — news-monitor (2)

  1742900100000-01HY.msg  [2m ago]  from: inbox-triage
    "Research this further: Iran nuclear talks stall..."

  1742900200000-01HZ.msg  [1m ago]  from: cli
    "scan"
```

### `bract read <name>`

Read messages from an agent's outbox.

```sh
bract read deep-researcher             # latest message
bract read deep-researcher --all       # all outbox messages
bract read deep-researcher --follow    # wait for new messages
bract read deep-researcher --since 1h  # last hour
```

---

## Messaging

### `bract send <name> <message>`

Send a message to an agent.

```sh
bract send news-monitor "scan"
bract send researcher "What are the latest developments in Solana L2s?"
bract send researcher - < prompt.txt    # read from stdin
```

Flags:
```
--from <string>    Sender identity (default: "cli")
--wait             Block until the agent responds, then print the response
```

### `bract pipe <from> <to>`

Wire one agent's outbox to another's inbox (persistent, survives restarts).

```sh
bract pipe news-monitor inbox-triage
bract pipe inbox-triage deep-researcher --filter "[RESEARCH]"
bract unpipe news-monitor inbox-triage   # remove a pipe
bract pipes                              # list all active pipes
```

Pipes are stored as files in `$BRACT_HOME/pipes/`:
```
pipes/
  news-monitor→inbox-triage.json
  inbox-triage→deep-researcher.json
```

---

## Memory

### `bract memory <name>`

Read or write an agent's persistent memory.

```sh
bract memory researcher              # list all keys
bract memory researcher get sources  # read a key
bract memory researcher set sources "https://news.ycombinator.com"
bract memory researcher delete sources
bract memory researcher import < memory.json  # bulk import
bract memory researcher export > backup.json  # bulk export
```

---

## Maintenance

### `bract validate`

Validate `bract.yml` without starting anything.

```sh
bract validate
bract validate --config ./other.yml
```

Checks:
- YAML is valid
- All required fields are present
- Agent names are unique and valid slugs
- No circular pipes
- Referenced models exist (optional, requires providers to be accessible)

### `bract gc`

Garbage collect old files to free disk space.

```sh
bract gc                        # dry run — show what would be deleted
bract gc --apply                # actually delete
bract gc --older-than 30d      # default: 7d
```

Deletes:
- Log files older than `--older-than`
- Processed inbox messages older than `--older-than`
- Crash records older than `--older-than` (when restartCount reset to 0)

### `bract status`

Show supervisor status and system health.

```sh
bract status
```

Output:
```
bract supervisor: running (pid 12345, uptime 6h)
bract home: ~/.bract (1.2 GB)
agents: 4 running, 0 dead
pipes: 3 active
```

---

## Exit codes

| Code | Meaning                          |
|------|----------------------------------|
| 0    | Success                          |
| 1    | General error                    |
| 2    | Usage error (bad flags/args)     |
| 3    | Agent not found                  |
| 4    | Agent is dead (max restarts)     |
| 5    | Config validation error          |

---

## Environment variables

| Variable              | Default                      | Description                         |
|-----------------------|------------------------------|-------------------------------------|
| `BRACT_HOME`          | `~/.bract`                   | Root directory for all agent state  |
| `BRACT_MODEL`         | (none)                       | Default model for `bract spawn`     |
| `BRACT_DEFAULT_PROVIDER` | `ollama`                  | Provider when no prefix given       |
| `OLLAMA_BASE_URL`     | `http://localhost:11434`     | Ollama API endpoint                 |
| `ANTHROPIC_API_KEY`   | (none)                       | Anthropic API key                   |
| `OPENAI_API_KEY`      | (none)                       | OpenAI API key                      |
| `OPENROUTER_API_KEY`  | (none)                       | OpenRouter API key                  |
