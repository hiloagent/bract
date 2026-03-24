# ADR-001: Filesystem as process table

**Status:** Accepted
**Date:** 2026-03-25

## Context

Agent frameworks typically store runtime state in memory (lost on crash), in databases (hidden from operators), or in cloud services (requires connectivity). This makes it hard to observe what agents are doing, debug failures, or recover from crashes.

Unix has solved this problem for 50 years: processes are files (`/proc`), state is files, communication is files. Any tool that can read a file can observe the system.

## Decision

The bract process table is a directory. Each agent has a subdirectory under `$BRACT_HOME/agents/{name}/` containing plain files:

```
$BRACT_HOME/agents/{name}/
  pid           plain text — current OS process ID, empty if not running
  status        plain text — one of: running | idle | dead | error
  model         plain text — model identifier in use
  started_at    plain text — ISO 8601 timestamp
  inbox/        directory — incoming messages as .msg files
  outbox/       directory — outgoing messages as .msg files
  memory/       directory — persistent key-value state as .json files
  logs/         directory — append-only NDJSON log files, one per day
```

Message files in `inbox/` and `outbox/` follow this naming convention:
```
{timestamp_ns}-{ulid}.msg    e.g. 1742860000000000000-01HX....msg
```

Message file format (JSON):
```json
{
  "id": "01HX....",
  "from": "cli",
  "ts": "2026-03-25T00:00:00.000Z",
  "body": "hello world",
  "metadata": {}
}
```

## Consequences

**Good:**
- `cat agents/my-agent/status` tells you immediately what an agent is doing
- `ls agents/my-agent/inbox/` shows pending messages — nothing is lost on crash
- `tail -f agents/my-agent/logs/2026-03-25.ndjson` streams live agent activity
- State survives restarts: inbox messages persist until processed
- No database, no special tooling required to observe the system
- Works fully offline — no cloud dependency

**Bad:**
- Filesystem polling has latency (~100ms). Not suitable for sub-100ms message delivery. Acceptable for conversational agents; not for high-frequency trading bots.
- File-per-message creates many small files under heavy load. Mitigated by periodic compaction.
- Cross-machine agents require a shared filesystem (NFS, SSHFS) or a different transport. Out of scope for v1.

## Alternatives considered

**SQLite:** Single-file, transactional, fast. But opaque — you need tooling to read it. Ruled out.

**Redis/TCP pub-sub:** Fast, flexible. But requires a running server, network connectivity, and is invisible to standard Unix tools. Ruled out for core; may be added as optional remote transport later.

**In-memory EventEmitter:** Simple, zero latency. But state is lost on crash and invisible to operators. Ruled out.
