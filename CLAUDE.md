# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is bract

A local-first agent runtime. Agents are Unix processes with filesystem-based state (`$BRACT_HOME/agents/{name}/` containing `pid`, `status`, `model`, `inbox/`, `outbox/`, `memory/`, `logs/`, `crashes/`). Everything is observable with standard Unix tools.

## Commands

```bash
bun install           # install dependencies (required before build)
bun test              # run all tests (bun:test)
bun run build         # build all packages (bun build with workspace resolution)
bun run typecheck     # typecheck all packages
```

Per-package: `cd packages/<name> && bun test` or `bun run typecheck`.

Run a single test by describe name: `bun test --match="Supervisor"`.

## Pitfalls

**Build fails with "Could not resolve" workspace packages**
- Cause: `bun install` not run yet, workspace links aren't set up
- Fix: Always run `bun install` before `bun run build`
- The build uses `bun build` which requires workspace dependencies to be resolved

## Architecture

Monorepo with four packages under `packages/`:

- **runtime** (`@losoft/bract-runtime`) — Core abstractions: `ProcessTable` (filesystem agent registry), `Message` (inbox/outbox I/O with `.msg` files), `InboxWatcher` (filesystem polling for new messages), `PipeValidator` (DFS cycle detection). Zero runtime dependencies.
- **supervisor** (`@losoft/bract-supervisor`) — Monitors agent PIDs, detects crashes, restarts with exponential backoff. Writes crash records to `crashes/`. Depends on runtime.
- **runner** (`@losoft/bract-runner`) — Connects agent inboxes to LLMs via OpenAI-compatible `/v1/chat/completions`. Polls inbox → calls model → writes to outbox. Depends on runtime.
- **cli** (`@losoft/bract-cli`) — Command-line interface: `ps`, `send`, `read`, `inbox`, `spawn`, `kill`. Depends on runtime.

Data flow: InboxWatcher detects `.msg` file → AgentRunner calls model → response written to outbox → PipeEngine forwards to downstream agent inboxes.

## Code conventions

- TypeScript strict mode, ES2022 target, NodeNext module resolution
- Bun runtime — use Bun APIs (`Bun.write`, `Bun.file`) over Node equivalents
- `@losoft/bract-runtime` must have zero external dependencies
- Tests live in `*.test.ts` files colocated with source
- Tests verify filesystem writes, not just return values (filesystem observability is the core promise)
- Tests use `mkdtempSync` for isolation
- JSDoc comment on every public function

## Commit style

Conventional Commits with gitmoji prefix:
```
✨ feat: add inbox watcher polling interval config
🐛 fix: supervisor restart backoff not resetting
📝 docs: add ADR-007 for memory system
♻️ refactor: extract frame parsing into separate module
🧪 test: add process-table register/deregister cases
```

## Design decisions

ADRs live in `docs/adrs/`. Key decisions: filesystem as process table (ADR-001), polling not inotify for inbox watching (ADR-002), supervisor restart policies with exponential backoff (ADR-003), declarative `bract.yml` fleet config (ADR-004), plugin model via filesystem interface (ADR-005), model routing for Ollama/Anthropic/OpenRouter (ADR-006), persistent memory as files (ADR-007), pipe engine for outbox-to-inbox forwarding (ADR-008).

## Core vs plugin boundary

Core: process table, inbox watcher, supervisor, CLI, message format, bract.yml parsing. Plugin (separate package): anything requiring an external service or new dependency — model providers, transport layers (Telegram/Slack), MCP servers, custom triggers.
