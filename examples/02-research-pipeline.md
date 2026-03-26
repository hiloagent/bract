# Example 02: Research Pipeline

A two-agent pipeline where a researcher feeds a writer.

## The Prompts

`prompts/researcher.md`:
```markdown
You are a research assistant. When given a topic, research it thoroughly
using the search tool. Return a structured JSON object with:
- summary: 2-3 sentence overview
- key_facts: array of important facts
- sources: array of URLs
```

`prompts/writer.md`:
```markdown
You are a technical writer. You receive research JSON and write
a polished 300-word article suitable for a developer blog.
Write in markdown. Include a title and 3-4 sections.
```

## One-shot Pipeline

```bash
# Chain the agents with Unix pipes
$ echo "quantum computing" \
  | bract run --prompt prompts/researcher.md --tools search \
  | bract run --prompt prompts/writer.md \
  > article.md

$ cat article.md
# Quantum Computing: The Next Frontier

Quantum computing leverages quantum mechanical phenomena...
```

## Persistent Pipeline

For ongoing research, spawn persistent agents and wire them together:

```bash
# Spawn both agents
$ RESEARCHER=$(bract spawn --name researcher --prompt prompts/researcher.md --tools search)
$ WRITER=$(bract spawn --name writer --prompt prompts/writer.md)

# Wire them: researcher output → writer input
$ bract pipe --detach $RESEARCHER $WRITER

# Now send topics to the researcher
$ bract write $RESEARCHER "quantum computing"
$ bract write $RESEARCHER "RISC-V architecture"
$ bract write $RESEARCHER "WebAssembly and the future of browsers"

# Read finished articles from the writer
$ bract read --all $WRITER
# ... articles appear as the pipeline completes

# Watch the pipeline live
$ bract ps
PID    NAME         STATUS    MODEL              UPTIME    TASKS
a1b2   researcher   running   claude-sonnet-4-6  3m10s     2/3
c3d4   writer       waiting   claude-sonnet-4-6  3m10s     1/2
```

## Filtered Pipeline

Use `--filter` to transform data between agents:

```bash
# Researcher returns JSON, writer only needs the summary field
$ bract pipe --filter '.summary' $RESEARCHER $WRITER
```

## Inspecting the Pipeline

Because everything is files, you can watch the state at any point:

```bash
# See what the researcher is working on
$ bract cat $RESEARCHER inbox
[
  {"id": "0003", "content": "WebAssembly and the future of browsers", ...}
]

# See the last article the writer produced
$ bract read --last $WRITER

# Stream the writer's output as it types
$ bract tail $WRITER
