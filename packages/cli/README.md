# @losoft/bract-cli

Command-line interface for [bract](https://github.com/hiloagent/bract) — the lightweight multi-agent framework. Spawn agents, send messages, inspect state, and manage a local agent fleet.

> **Note:** The CLI is distributed as a compiled binary built from source. See [Getting Started](#getting-started) below.

## Getting Started

```bash
git clone https://github.com/hiloagent/bract
cd bract
bun install
cd packages/cli && bun run build
```

The compiled binary is at `packages/cli/dist/bract`. Add it to your PATH or use it directly.

## Commands

### Fleet

```bash
bract up [--follow]      # Start supervisor + all agents from bract.yml
bract down               # Stop supervisor and all agents
bract ps                 # List all agents and their status
```

### Agent

```bash
bract spawn <name>               # Spawn an agent (foreground)
bract spawn <name> --detach      # Spawn an agent (background, detached)
bract spawn --all --detach       # Spawn all agents from bract.yml
bract log <name> [-f]            # Show agent logs, -f to stream
```

### Messaging

```bash
bract send <name> "hello"        # Send a message to an agent
bract send <name> -              # Read message from stdin
bract inbox <name>               # Show pending inbox messages
bract read <name>                # Show latest outbox message
```

### Config

```bash
bract validate                   # Validate bract.yml in current directory
bract validate --file path.yml   # Validate a specific file
bract validate --json            # Machine-readable output
```

## bract.yml

```yaml
version: 1
agents:
  - name: assistant
    model: qwen2.5:7b
    system: |
      You are a concise assistant.
    restart: on-failure   # always | on-failure | never
```

Place `bract.yml` in your project directory, then run `bract up`.

## Flags

| Flag | Description |
|---|---|
| `--home <path>` | Override `BRACT_HOME` (default: `~/.bract`) |
| `--json` | Machine-readable JSON output |
| `--quiet` | Suppress non-essential output |

Global flags can be placed before or after the subcommand.

## License

MIT
