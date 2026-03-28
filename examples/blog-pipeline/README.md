# Blog Pipeline

Three agents. One topic. A finished blog post.

```
[outliner] ──pipes──► [writer] ──pipes──► [editor]
```

You send a topic to `outliner`. It writes a 5-section outline, which
pipes automatically to `writer`. The writer expands it into a full
draft, which pipes to `editor`. The editor polishes it. You read the
finished post — no orchestration code, no glue scripts.

## Prerequisites

- [Ollama](https://ollama.ai) running locally with `qwen2.5:7b` pulled
- `bract` installed (`npm install -g @losoft/bract-cli`)

```sh
ollama pull qwen2.5:7b
```

## Run

```sh
cd examples/blog-pipeline

# Start the fleet (detached — runs in the background)
bract up

# Drop a topic in
bract send outliner "why local-first software is making a comeback"

# Watch the pipeline move (optional — Ctrl+C to stop following)
bract log writer -f

# Read the finished post (~30–60s on a laptop)
bract read editor

# Stop the fleet when done
bract down
```

## What's happening

1. `outliner` receives your topic and writes a structured outline
2. The supervisor's pipe router detects the new outbox message
3. It forwards the outline into `writer`'s inbox automatically
4. `writer` expands the outline into a full draft
5. That draft is forwarded to `editor`'s inbox
6. `editor` polishes the final post

All state lives in plain files under `~/.bract/` (or `$BRACT_HOME`).
Kill any process and restart — nothing is lost.

## Try other topics

```sh
bract send outliner "the case for boring technology"
bract send outliner "what makes a great CLI tool"
bract send outliner "why most side projects fail in week two"
bract send outliner "the hidden cost of 'just use an LLM'"
```

Messages queue — run several and read them when ready.

## Swap the model

Edit `bract.yml` and change `model` on any agent. Mix local and cloud:

```yaml
  - name: editor
    model: anthropic/claude-sonnet-4-6   # upgrade the final step
    ...
```

Requires `ANTHROPIC_API_KEY` in your environment.
