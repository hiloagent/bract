# ADR-002: Inbox watcher via filesystem polling

**Status:** Accepted
**Date:** 2026-03-25

## Context

Agents need to receive messages. Once a message file lands in `inbox/`, something
must notice it and trigger the agent. The question is how that notification happens.

Options:
1. **Filesystem events** (`fs.watch`, `inotify`, `kqueue`)
2. **Polling** — stat/readdir on a timer
3. **Socket/pipe** — sender signals the receiver directly

## Decision

Use polling at a configurable interval (default 200 ms).

The poll loop reads `inbox/` for each registered agent, consumes any `.msg` files
found, and emits a `message` event. Consumed files are moved to `inbox/.processed/`
rather than deleted — they remain readable for debugging.

```
InboxWatcher.poll()
  for each agent directory:
    list *.msg files in inbox/ (sorted by filename → oldest first)
    for each file:
      read + parse JSON
      move to inbox/.processed/
      emit('message', { agentName, filename, message })
```

## Rationale

**Why not `fs.watch`?**

`fs.watch` is notoriously unreliable across platforms (macOS, Linux, Windows each have
quirks). It does not work over NFS or SSHFS, which are valid bract deployment targets.
It can miss events under high write load. The added complexity is not worth 200 ms
of latency for conversational agents.

**Why not sockets/pipes?**

The core bract principle is that everything is a file. A socket-based notification
channel would require the receiver to be running before the sender sends. With
file-based polling, messages persist even if the agent is not yet started — they
are delivered on next poll. This is the same reason Unix mail spools work the way
they do.

**Why move to `.processed/` rather than delete?**

Deleted files are unrecoverable. A moved file can be inspected after the fact to
debug what the agent received. `.processed/` is a hidden directory (dot-prefixed)
so `ls inbox/` still gives a clean view of pending messages.

## Consequences

- Message delivery latency: up to `pollIntervalMs` (default 200 ms). Acceptable
  for conversational agents. For tighter latency, callers can set `pollIntervalMs: 50`.
- At high message volume, many small files accumulate in `.processed/`. A future
  compaction pass can archive these to NDJSON logs.
- `InboxWatcher` extends `EventEmitter`. Callers attach `'message'` handlers before
  calling `.start()`. Errors are surfaced via the standard `'error'` event.
- `InboxWatcher.forAgent(root, name)` scopes polling to a single agent, skipping the
  directory scan — useful in single-agent processes.
