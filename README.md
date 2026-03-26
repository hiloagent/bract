# bract

> A local-first agent runtime where agents work like Unix processes.

---

## What is bract?

bract is an agent runtime built around a single mental model: **agents are processes**.

Just like a Unix process has a PID, a working directory, stdin/stdout, environment variables, and an exit code — a bract agent has all of that, plus a structured state directory that lives entirely in your filesystem.

There is no hidden cloud state. No opaque orchestration layer. Everything an agent is, does, and remembers is visible as files on your disk.

```
~/.bract/agents/
├── 7a2f/                     # agent PID (short hash)
│   ├── meta.json             # name, model, created_at, status
│   ├── env                   # environment variables
│   ├── cwd -> /workspace/foo # symlink to working directory
│   ├── inbox/                # pending messages/tasks
│   ├── outbox/               # completed outputs
│   ├── memory/               # persistent memory files
│   ├── stdout                # live log of agent output
│   └── stderr                # errors and warnings
```

---

## Design Principles

**1. Local-first.** Your agents run on your machine. State lives in your filesystem. Nothing requires a network unless the task does.

**2. Unix-native.** Agents compose with pipes, redirects, `grep`, `watch`, `tail -f`. The process model is not a metaphor — it's the actual interface.

**3. Observable by default.** At any moment you can `cat`, `ls`, or `watch` the state of any running agent. No dashboards needed.

**4. Minimal protocol.** Agents communicate through structured files (JSON, NDJSON, plain text). The wire format is the storage format.

**5. Composable.** Agents can spawn child agents, forward their inbox, or be piped into each other. Orchestration is just file I/O.

---

## Quick Start

```bash
# Install
npm install -g bract

# Spawn an agent
bract spawn --name researcher --model claude-sonnet-4-6

# Send it a task
echo "What is the capital of France?" | bract write 7a2f

# Watch its output
bract tail 7a2f

# Check the process table
bract ps

# Kill it
bract kill 7a2f
```

---

## The Process Model

### Spawning

```bash
bract spawn [options]
  --name <name>        Human-readable name
  --model <model>      LLM to use (default: claude-sonnet-4-6)
  --cwd <path>         Working directory (default: current dir)
  --env <KEY=VAL>      Environment variable (repeatable)
  --prompt <text>      System prompt or path to .md file
  --memory <path>      Pre-load memory from directory
  --parent <pid>       Spawn as child of another agent
```

Every spawned agent gets:
- A short hash PID (e.g. `7a2f`)
- A state directory at `~/.bract/agents/<pid>/`
- A running process that reads from its inbox

### The Inbox/Outbox Pattern

Agents receive work via their **inbox** — a directory of message files:

```
inbox/
├── 0001.json    # {"type": "task", "content": "...", "from": "user"}
├── 0002.json    # {"type": "task", "content": "...", "from": "a3bc"}
```

Each message is a JSON file. When processed, it moves to `outbox/` with a result:

```
outbox/
├── 0001.json    # {"status": "done", "result": "Paris", "elapsed_ms": 1240}
```

### stdin/stdout

For interactive or piped use:

```bash
# Pipe a prompt in
echo "Summarize this file" | bract run --model claude-haiku-4-5 < report.txt

# Run a one-shot agent with a file as stdin
bract run --prompt analyst.md < data.csv

# Chain agents
bract run --prompt extract.md < raw.txt | bract run --prompt summarize.md
```

`bract run` is ephemeral — no persistent state directory. Good for scripting.

### Environment

Agents inherit environment variables from their parent (the shell or parent agent), filtered by a whitelist. Additional vars can be set at spawn time.

The `env` file in the agent directory is plain `KEY=VALUE` format, readable with any standard tool.

---

## Process Table

```bash
bract ps
```

```
PID    NAME         STATUS    MODEL                  UPTIME   TASKS
7a2f   researcher   running   claude-sonnet-4-6      4m32s    3/5
a3bc   analyst      idle      claude-haiku-4-5       12m01s   8/8
f91e   writer       waiting   claude-opus-4-6        2m15s    1/2
```

`bract ps` reads directly from `~/.bract/agents/*/meta.json`. No daemon required.

---

## Memory Model

Agents have two memory layers:

**Working memory** — the active context window. Managed automatically.

**Persistent memory** — files in `~/.bract/agents/<pid>/memory/`. The agent can read and write these explicitly. They survive restarts. They're plain text or JSON — you can edit them with any editor.

```bash
# See what an agent remembers
ls ~/.bract/agents/7a2f/memory/
cat ~/.bract/agents/7a2f/memory/user_preferences.md

# Inject a memory
echo "User prefers bullet points." > ~/.bract/agents/7a2f/memory/style.md
```

Memory files follow the same format as [Claude Code's auto-memory](https://docs.anthropic.com) — markdown with YAML frontmatter. This is intentional: agents running inside Claude Code can share memory directly.

---

## Signals

Like Unix processes, agents respond to signals:

```bash
bract kill <pid>          # SIGTERM — graceful shutdown (agent saves state)
bract kill -9 <pid>       # SIGKILL — immediate stop
bract pause <pid>         # SIGSTOP — suspend processing
bract resume <pid>        # SIGCONT — resume processing
bract reload <pid>        # SIGHUP — reload prompt/config without restart
```

On SIGTERM, the agent writes a final summary to `outbox/final.json` before exiting.

---

## Pipes and Composition

bract agents compose naturally:

```bash
# Run a team: researcher feeds writer
bract spawn --name researcher --prompt researcher.md
bract spawn --name writer --prompt writer.md

# Wire them together
bract pipe researcher writer   # researcher outbox → writer inbox

# Or use Unix pipes for one-shot chains
bract run --prompt research.md <<< "quantum computing" \
  | bract run --prompt write_post.md \
  > post.md
```

### Agent Groups

A **group** is a named collection of agents that share a common inbox:

```bash
bract group create --name team-alpha 7a2f a3bc f91e
echo "Analyze Q1 results and write a summary" | bract write team-alpha
```

Messages sent to a group are broadcast to all members.

---

## Scheduling

```bash
# Run an agent on a cron schedule
bract schedule --cron "0 9 * * *" --prompt daily_brief.md --name morning-brief

# One-shot future run
bract schedule --at "2026-04-01T09:00:00" --prompt april-fools.md
```

Scheduled agents appear in `bract ps` with a `scheduled` status and next-run time.

---

## Plugins

bract has a minimal plugin system built on executables:

```bash
~/.bract/plugins/
├── bract-search/     # provides the `search` tool to agents
├── bract-browse/     # provides the `browse` tool
└── bract-notify/     # sends system notifications on agent events
```

Any executable in `~/.bract/plugins/` that follows the bract tool protocol becomes available to agents as a callable tool. See [Plugin Protocol](docs/plugin-protocol.md).

---

## Configuration

```
~/.bract/config.json
```

```json
{
  "default_model": "claude-sonnet-4-6",
  "api_key_env": "ANTHROPIC_API_KEY",
  "state_dir": "~/.bract/agents",
  "plugins_dir": "~/.bract/plugins",
  "log_level": "info",
  "inbox_poll_ms": 500
}
```

Project-level config at `.bract.json` in any directory overrides global config.

---

## Why "bract"?

A bract is a leaf-like structure that surrounds or subtends a flower — it's the scaffolding that holds things in place while growth happens. The name reflects the project's role: bract doesn't do the thinking. It just holds the structure so agents can.

---

## Status

Early design phase. APIs will change. Contributions welcome.

See [docs/adrs/](docs/adrs/) for architecture decisions.
