# bract CLI Reference

bract follows the Git/kubectl subcommand pattern: `bract <command> [options] [args]`.

---

## Agent Lifecycle

### `bract spawn`

Spawn a persistent agent.

```
bract spawn [options]

Options:
  --name <name>          Human-readable name (optional, auto-generated if omitted)
  --model <model>        LLM model (default: claude-sonnet-4-6)
  --cwd <path>           Working directory (default: current directory)
  --env <KEY=VAL>        Environment variable (repeatable)
  --prompt <text|path>   System prompt text, or path to .md file
  --memory <path>        Seed memory from a directory
  --tools <list>         Comma-separated list of tool names to enable
  --parent <pid>         Spawn as child of another agent
  --no-tools             Disable all tools

Output:
  Prints the agent PID to stdout.

Examples:
  bract spawn --name researcher --model claude-opus-4-6 --prompt prompts/researcher.md
  bract spawn --name worker --cwd /workspace/project --tools search,browse
  PID=$(bract spawn --name ephemeral)   # capture PID
```

### `bract run`

Run a one-shot agent (ephemeral, no persistent state).

```
bract run [options] [-- command]

Options:
  --model <model>        LLM model (default: claude-haiku-4-5)
  --prompt <text|path>   System prompt
  --tools <list>         Tools to enable
  --no-tools             Disable all tools
  --max-turns <n>        Maximum agentic turns (default: 10)
  --timeout <seconds>    Abort after this many seconds

Stdin: task input
Stdout: agent output
Stderr: bract runtime messages (progress, errors)

Exit codes:
  0   Agent completed successfully
  1   Agent reported an error
  2   Runtime error (timeout, model error, etc.)

Examples:
  echo "Summarize this" | bract run --prompt analyst.md < report.txt
  bract run --model claude-opus-4-6 <<< "Write me a haiku about filesystems"
  cat data.csv | bract run --tools search | bract run --prompt format.md
```

### `bract kill`

Stop a running agent.

```
bract kill [options] <pid>

Options:
  -9             Force kill (immediate, no state save)
  --all          Kill all running agents

Behavior:
  Without -9: sends graceful shutdown signal. Agent completes current turn,
              writes final.json to outbox/, then exits.
  With -9:    immediate termination, no state save.

Examples:
  bract kill 7a2f
  bract kill -9 7a2f
  bract kill --all
```

### `bract pause` / `bract resume`

Suspend and resume agents.

```
bract pause <pid>      # suspend processing (finishes current turn first)
bract resume <pid>     # resume a paused agent
```

### `bract reload`

Reload an agent's prompt and config without restarting.

```
bract reload <pid>     # re-reads prompt.md and env files
```

---

## Inspection

### `bract ps`

List agents (reads from filesystem, no daemon required).

```
bract ps [options]

Options:
  --all          Include exited/crashed agents
  --json         Output as JSON
  --watch        Live-updating display (like watch)
  --sort <field> Sort by: pid, name, status, uptime, tasks (default: uptime)

Output columns:
  PID    Short hash identifier
  NAME   Human-readable name
  STATUS running | idle | waiting | paused | exited | crashed
  MODEL  LLM model name
  UPTIME Time since spawn
  TASKS  Completed/total tasks

Examples:
  bract ps
  bract ps --all --json | jq '.[] | select(.status == "crashed")'
  bract ps --watch
```

### `bract tail`

Stream agent output in real time.

```
bract tail [options] <pid>

Options:
  -n <lines>     Show last N lines before following (default: 10)
  --no-follow    Print existing output and exit (like tail without -f)
  --stderr       Show stderr instead of stdout

Examples:
  bract tail 7a2f
  bract tail -n 50 7a2f
  bract tail --stderr 7a2f
```

### `bract cat`

Print agent state files.

```
bract cat [options] <pid> [file]

Files:
  meta          meta.json — status, model, created_at
  env           environment variables
  prompt        system prompt
  inbox         list of pending tasks
  outbox        list of completed outputs
  memory        list of memory files
  stdout        full stdout log
  stderr        full stderr log

  Omit file to list available files.

Examples:
  bract cat 7a2f meta
  bract cat 7a2f inbox
  bract cat 7a2f memory/preferences.md
```

### `bract inspect`

Rich view of a single agent (combines meta, recent activity, memory summary).

```
bract inspect <pid>

Output (example):
  Agent: researcher (7a2f)
  Model: claude-sonnet-4-6
  Status: idle
  Uptime: 12m 34s
  CWD: /workspace/project

  Tasks: 5 completed, 0 pending
  Last task: "Research Unix history" — 1m 23s ago

  Memory: 3 files
    user_context.md — "User is a software engineer..."
    project_notes.md — "Working on bract, a Unix-style agent runtime..."
    preferences.md — "Prefers bullet points, concise answers"

  Recent output (last 5 lines):
    > Unix was created at Bell Labs in 1969 by Ken Thompson...
```

---

## Messaging

### `bract write`

Send a task to an agent (or group).

```
bract write [options] <pid|group-name>

Options:
  --type <type>   Message type: task (default), note, signal
  --from <pid>    Sender PID (default: "user")
  --wait          Block until the agent completes this task

Input: task text on stdin, or as a positional argument
Output: message ID

Examples:
  echo "What is the capital of France?" | bract write 7a2f
  bract write 7a2f "Summarize the Q1 results"
  bract write --wait 7a2f "Write a haiku" && echo "Done"
```

### `bract read`

Read output from an agent.

```
bract read [options] <pid>

Options:
  --id <id>      Read a specific output by message ID
  --last         Read the most recent output (default)
  --all          Read all unread outputs
  --wait         Block until new output is available
  --json         Output as JSON

Examples:
  bract read 7a2f
  bract read --wait 7a2f
  bract read --all 7a2f | jq '.result'
```

### `bract pipe`

Wire one agent's outbox to another's inbox.

```
bract pipe [options] <source-pid> <dest-pid>

Options:
  --filter <jq-expr>   Filter/transform messages using jq expression
  --detach             Run in background (default: runs in foreground)

Examples:
  bract pipe researcher writer
  bract pipe --filter '.result' extractor formatter
  bract pipe --detach researcher writer
```

---

## Groups

### `bract group`

Manage agent groups (named collections that share an inbox).

```
bract group create --name <name> [pid...]    # create group, optionally with members
bract group add <name> <pid>                 # add agent to group
bract group remove <name> <pid>              # remove agent from group
bract group list                             # list all groups
bract group show <name>                      # show members and status
bract group delete <name>                    # delete group (does not kill agents)

Examples:
  bract group create --name research-team 7a2f a3bc
  bract write research-team "Analyze this dataset"
  bract group show research-team
```

---

## Scheduling

### `bract schedule`

Schedule agent tasks.

```
bract schedule [options]

Options:
  --cron <expr>       Cron expression for recurring schedule
  --at <datetime>     ISO 8601 datetime for one-shot run
  --name <name>       Spawn a new agent for each run (uses this name)
  --pid <pid>         Send task to existing agent on schedule
  --prompt <path>     System prompt file for spawned agents
  --task <text>       Task to send (for --pid mode)
  --persist           Keep agent alive between runs (default: kill after each run)

Examples:
  # Spawn a fresh agent every morning at 9am
  bract schedule --cron "0 9 * * *" --name morning-brief --prompt prompts/brief.md

  # Send a daily task to a persistent agent
  bract schedule --cron "0 9 * * *" --pid 7a2f --task "Prepare daily summary"

  # One-shot future task
  bract schedule --at "2026-04-01T09:00:00" --name april-agent --prompt joke.md
```

### `bract schedules`

List scheduled tasks.

```
bract schedules [options]

Options:
  --json    Output as JSON

Output columns:
  ID      Schedule identifier
  TYPE    cron | once
  EXPR    Cron expression or datetime
  TARGET  Agent name/PID or "<spawn>"
  NEXT    Next run time
  LAST    Last run time
```

---

## Plugins

### `bract plugin`

Manage plugins.

```
bract plugin list                          # list installed plugins
bract plugin install <path|url>            # install a plugin
bract plugin remove <name>                 # remove a plugin
bract plugin describe <name>               # show plugin schema
bract plugin test <name>                   # interactively test a plugin

Examples:
  bract plugin list
  bract plugin install ./my-plugin
  bract plugin describe search
  echo '{"query":"test"}' | bract plugin test search
```

---

## Memory

### `bract memory`

Manage agent memory.

```
bract memory list <pid>                      # list memory files
bract memory show <pid> [file]               # show memory content
bract memory inject <pid> <file>             # copy a file into agent memory
bract memory remove <pid> <file>             # delete a memory file
bract memory edit <pid> [file]               # open in $EDITOR

Examples:
  bract memory list 7a2f
  bract memory show 7a2f preferences.md
  bract memory inject 7a2f ./my-context.md
  bract memory edit 7a2f preferences.md
```

---

## Maintenance

### `bract gc`

Garbage collect stale agent state.

```
bract gc [options]

Options:
  --dry-run    Show what would be removed without removing it
  --all        Remove all exited agents (default: only remove crashed ones)
  --older <d>  Remove agents that exited more than <d> days ago (default: 7)

Examples:
  bract gc --dry-run
  bract gc --all --older 30
```

### `bract config`

Manage bract configuration.

```
bract config get [key]         # show all config, or a specific key
bract config set <key> <val>   # set a config value
bract config edit              # open in $EDITOR

Examples:
  bract config get
  bract config get default_model
  bract config set default_model claude-opus-4-6
```

---

## Global Flags

These flags work with any command:

```
--state-dir <path>   Override state directory (default: ~/.bract/agents)
--config <path>      Override config file (default: ~/.bract/config.json)
--quiet, -q          Suppress runtime messages
--debug              Verbose runtime output
--json               Output as JSON (where supported)
```

---

## Exit Codes

```
0   Success
1   Agent error (task failed, agent exited non-zero)
2   Runtime error (model unavailable, filesystem error, etc.)
3   Agent not found
4   Invalid arguments
5   Timeout
```

---

## Environment Variables

```
BRACT_STATE_DIR         Override default state directory (~/.bract/agents)
BRACT_CONFIG            Override config file path
BRACT_DEFAULT_MODEL     Default model for new agents
ANTHROPIC_API_KEY       Anthropic API key (required unless set in config)
BRACT_DEBUG             Enable debug output (same as --debug)
```
