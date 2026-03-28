# Changelog

All notable changes to bract are documented here.

## [0.1.0] — 2026-03-28

First public release.

### Packages

| Package | Version |
|---------|---------|
| `@losoft/bract-cli` | 0.1.0 |
| `@losoft/bract-runtime` | 0.1.0 |
| `@losoft/bract-runner` | 0.1.0 |
| `@losoft/bract-supervisor` | 0.1.0 |
| `@losoft/bract-memory` | 0.1.0 |
| `@losoft/bract-client` | 0.1.0 |

### What's included

**CLI** (`bract`)
- `bract up` / `bract down` — start and stop the supervisor and all agents from `bract.yml`
- `bract ps` — list all agents and their status
- `bract spawn <name>` — start a single agent from `bract.yml`
- `bract send <name> <message>` — write a message to an agent's inbox
- `bract read <name>` — read the latest outbox message(s)
- `bract inbox <name>` — show pending inbox messages
- `bract log <name> [-f] [--all]` — stream or view agent logs
- `bract validate [--file <path>] [--json]` — validate `bract.yml` against schema and pipe rules
- `bract init [--file <path>] [--json] [--force]` — scaffold a starter `bract.yml`
- Global flags: `--home <path>`, `--json`, `--quiet`
- Pre-compiled binaries for Linux x64/arm64, macOS x64/arm64

**Runtime** (`@losoft/bract-runtime`)
- `ProcessTable` — filesystem-based process registry (`pid`, `status`, `model`)
- `InboxWatcher` — polling-based inbox monitor, triggers agent on new messages
- `MessageStore` — inbox/outbox read, write, consume-to-processed
- `BractLogger` — append-only structured daily log files

**Runner** (`@losoft/bract-runner`)
- `AgentRunner` — connects inbox watcher to LLM to outbox
- Multi-provider model routing: Ollama (default), Anthropic, OpenAI, OpenRouter
- Memory injection — agent memory files loaded into system prompt automatically

**Supervisor** (`@losoft/bract-supervisor`)
- Long-running supervisor process with health monitoring (heartbeat every 5s)
- Restart policy: `always`, `on-failure`, `never` with exponential backoff
- Pipe engine — outbox-to-inbox forwarding via `bract.yml` pipe rules
- Agents keep running if supervisor dies; restart resumes on supervisor recovery

**Memory** (`@losoft/bract-memory`)
- Seven filesystem memory tools: `memory_read`, `memory_write`, `memory_append`, `memory_replace`, `memory_grep`, `memory_glob`, `memory_delete`

**Client** (`@losoft/bract-client`)
- Thin programmatic client for sending messages to agent inboxes from external code

### Platform support

Linux x64, Linux arm64, macOS x64, macOS arm64.
Windows via WSL (Linux binary).
