# ADR-007: Memory system — persistent key-value per agent

**Status:** Accepted
**Date:** 2026-03-26

---

## Context

Agents need memory that persists across messages and restarts. Without it, every
message is processed cold — the agent knows nothing about previous interactions,
user preferences, or accumulated findings.

The existing filesystem layout includes a `memory/` directory per agent:

```
~/.bract/agents/<name>/
  memory/     ← this ADR specifies what goes here
```

The question is what format, what semantics, and what the API should look like.

Options:
1. **Key-value store backed by SQLite** — fast, queryable, single file
2. **Flat JSON file** — simple, whole-object read/write
3. **Directory of plain text/markdown files** — one file per memory entry
4. **Vector database** — semantic search over memories
5. **External store (Redis, etc.)** — network-accessible, not local-first

## Decision

**Memory is a directory of plain text files.**

Each file in `memory/` is one memory entry. Files are plain text, usually markdown.
The agent reads them like documents — entire files, not key lookups.

```
~/.bract/agents/my-agent/
  memory/
    preferences.md       ← how the user likes responses
    project-context.md   ← what we're working on
    findings.md          ← accumulated research results
    important-dates.md   ← dates and deadlines to know
```

### File format

Any plain text is valid. Structured memories use markdown with an optional YAML
frontmatter header:

```markdown
---
key: preferences
updated: 2026-03-26T05:12:00Z
---

User prefers short, direct responses. Uses bullet points when listing things.
Dislikes unnecessary preamble.
```

The frontmatter is optional. Agents can read and write files without it.

### Agent access

Agents see their memory directory as part of their context. The runtime injects
memory into the system prompt on each turn:

```
[Memory — preferences.md]
User prefers short, direct responses...

[Memory — project-context.md]
Working on bract, a Unix-style agent runtime...
```

Memory injection is configurable:
- `memory: all` — inject all files (default)
- `memory: [file1, file2]` — inject specific files
- `memory: none` — no memory injection (agent still has access, just not pre-injected)

### Memory tools

Agents access their memory via built-in tools (always available, no MCP server needed):

**`memory_read(key)`** — read a memory file by name:
```json
{ "tool": "memory_read", "input": { "key": "preferences" } }
→ "User prefers short, direct responses..."
```

**`memory_write(key, content)`** — create or overwrite a memory file:
```json
{ "tool": "memory_write", "input": { "key": "findings", "content": "..." } }
→ { "written": true }
```

**`memory_append(key, content)`** — append to an existing memory file (creates it if absent):
```json
{ "tool": "memory_append", "input": { "key": "findings", "content": "- New finding
" } }
→ { "appended": true }
```
Avoids reading the full file when only adding new content at the end.

**`memory_replace(key, old, new)`** — find-and-replace within a memory file:
```json
{ "tool": "memory_replace", "input": { "key": "preferences", "old": "dislikes preamble", "new": "dislikes preamble and bullet lists" } }
→ { "replaced": true, "count": 1 }
```
Targeted update without a full read-modify-write cycle. Fails if `old` is not found.

**`memory_grep(pattern)`** — search across all memory files by content:
```json
{ "tool": "memory_grep", "input": { "pattern": "TypeScript" } }
→ [{ "key": "code-style", "line": 3, "excerpt": "Focus on TypeScript..." }]
```
Essential when the agent has many memory files and needs to find relevant context
without injecting all of them. Pattern is a plain substring or regex.

**`memory_glob(pattern)`** — find memory files by filename pattern:
```json
{ "tool": "memory_glob", "input": { "pattern": "project-*" } }
→ ["project-context", "project-deadlines"]
```
Useful when memory is organised with naming conventions or prefixed by topic.

**`memory_list()`** — list all memory keys:
```json
{ "tool": "memory_list", "input": {} }
→ ["preferences", "project-context", "findings"]
```

**`memory_delete(key)`** — remove a memory file:
```json
{ "tool": "memory_delete", "input": { "key": "stale-context" } }
→ { "deleted": true }
```

### External access via CLI

Memory files are just files — read and write them directly:

```sh
# Read a memory
bract memory my-agent preferences

# Write a memory
echo "Focus on TypeScript, avoid Python examples" | bract memory my-agent code-style --write

# Edit in $EDITOR
bract memory my-agent preferences --edit

# List all memories
bract memory my-agent

# Delete a memory
bract memory my-agent stale-notes --delete
```

Or bypass the CLI entirely:
```sh
cat ~/.bract/agents/my-agent/memory/preferences.md
echo "New preference" >> ~/.bract/agents/my-agent/memory/preferences.md
```

### Memory seeding

When spawning an agent, pre-populate its memory:

```sh
bract spawn my-agent --model qwen3.5:9b --seed-memory ./context/
```

This copies all files from `./context/` into the agent's `memory/` directory.

In `bract.yml`:
```yaml
agents:
  - name: analyst
    model: anthropic/claude-sonnet-4-6
    memory:
      seed: ./context/analyst/    # relative to bract.yml
```

### Memory sharing between agents

Agents don't share memory by default. To share context:

```sh
# Copy a memory from one agent to another
cp ~/.bract/agents/researcher/memory/findings.md \
   ~/.bract/agents/writer/memory/research-input.md

# Or symlink for live sync (writer always sees researcher's latest findings)
ln -s ~/.bract/agents/researcher/memory/findings.md \
      ~/.bract/agents/writer/memory/findings.md
```

Symlinks work because memory access is just file I/O.

### Memory injection size limits

Long memories grow context. The runtime handles this:

- Files under 2KB are injected in full
- Files 2KB–20KB are truncated at 2KB with a `[truncated — N chars remaining]` note
- Files over 20KB are excluded from auto-injection (still readable via `memory_read`)

These limits are configurable in `bract.yml`:

```yaml
memory:
  inject_limit_kb: 4     # per-file limit before truncation
  inject_total_kb: 16    # total memory injection limit
```

## Consequences

### Good

**Observable and editable.** Memory is just files. Any text editor works.
`grep -r "preference" ~/.bract/agents/*/memory/` finds anything.

**No database.** No SQLite, no migration scripts, no corruption risk from
concurrent writes to a single file. Crashes during a write at worst corrupt
one file.

**Composable.** Symlinks enable shared memory. `rsync` backs it up.
`git -C memory init && git add -A && git commit` version-controls it.

**Language-agnostic.** Sidecar plugins can read and write memory without
any SDK — just file I/O.

**Incremental.** Agents can grow their memory over time. New files appear.
Old files get updated. The directory is the source of truth.

### Tricky

**No semantic search.** Plain text files don't support "find memories similar
to this query". If an agent has 50 memory files, injection of all of them
would blow the context window.

Mitigation for v1: agents manage their own memory — they write specific,
focused files and prune stale ones via `memory_delete`. This is intentional:
memory hygiene is the agent's responsibility, not the runtime's.

Future: an optional memory index (a `MEMORY.md` index file, like Claude Code's
auto-memory system) lets agents maintain their own summary/index.

**File size limits depend on filesystem.** Not a practical issue for
text-based memory files, but worth noting.

**No transactions.** If an agent writes multiple memory files as part of one
operation and crashes mid-way, some writes may succeed and others not.
Acceptable for the use case — memory is soft state, not a transaction log.

**Memory injection is per-turn.** The runtime re-reads all memory files at
the start of each turn. This means a memory write in turn N is visible in
turn N+1 — intentional, but the cost is a filesystem scan each turn.
Mitigation: the runtime caches file mtimes and only re-reads changed files.

## Alternatives Considered

### SQLite

Fast, queryable, ACID. Rejected: not directly editable with text tools,
not readable without sqlite3, breaks the "everything is a file" principle.

### Single JSON file (`memory.json`)

Simple. Rejected: concurrent writes require locking, the whole file must
be read/written for any update, not streamable or greppable.

### Vector database (Chroma, pgvector)

Enables semantic search over large memory corpora. Rejected for v1:
requires a running service, not local-first, massive complexity for a
feature that most agents won't need. Can be added as a sidecar plugin
when needed.

### External store (Redis, etc.)

Not local-first. Rejected outright.

## References

- Claude Code auto-memory system — same markdown-with-frontmatter format
- [Zettelkasten](https://zettelkasten.de/introduction/) — atomic notes as a model for agent memory
- Linux `/proc/<pid>/environ` — per-process state as files
