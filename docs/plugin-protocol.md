# Plugin Protocol

This document specifies the protocol that bract plugins must implement.

## Overview

A bract plugin is an executable file (or the main executable in a directory) that:
1. Responds to `describe` with a JSON tool definition
2. Responds to `invoke` with JSON input on stdin, and outputs a JSON result

The protocol is intentionally minimal. Any language, any runtime.

## Commands

### `<plugin> describe`

Returns the tool's JSON schema on stdout. No stdin. Exit 0 on success.

**Output format** (Anthropic tool definition):
```json
{
  "name": "tool_name",
  "description": "Human-readable description of what the tool does.",
  "input_schema": {
    "type": "object",
    "properties": {
      "param_name": {
        "type": "string",
        "description": "What this parameter does"
      }
    },
    "required": ["param_name"]
  }
}
```

Rules:
- `name` must match `[a-zA-Z0-9_-]+` (no spaces)
- `description` should be 1-3 sentences; it's included in the LLM's context
- `input_schema` follows [JSON Schema draft-07](https://json-schema.org/draft-07/json-schema-validation.html)
- Output must be valid JSON (single object, no trailing newline required)

### `<plugin> invoke`

Reads JSON input from stdin. Writes JSON output to stdout. Exit 0 always (use the `status` field for errors).

**Input:** JSON object matching the `input_schema` from `describe`

**Output (success):**
```json
{
  "status": "ok",
  "result": <any JSON value>
}
```

**Output (error):**
```json
{
  "status": "error",
  "error": "Human-readable error message",
  "retry_after": 60
}
```

Fields:
- `status`: required, `"ok"` or `"error"`
- `result`: required when status is `"ok"`, any JSON type
- `error`: required when status is `"error"`, string
- `retry_after`: optional, integer seconds to wait before retrying (rate limits, etc.)

### Streaming output

For long-running tools, emit progress lines before the final result. Each line is a JSON object:

```
{"type": "progress", "message": "Navigating to URL..."}
{"type": "progress", "message": "Page loaded."}
{"status": "ok", "result": {...}}
```

Rules:
- Progress lines have `"type": "progress"` and a `"message"` string
- The final line is the result object (no `"type"` field, has `"status"`)
- Each JSON object is on its own line (NDJSON)
- The runtime displays progress messages in the agent's stdout log
- Only the final result is passed to the LLM

## Environment

When the runtime invokes a plugin, it sets these environment variables:

```
BRACT_AGENT_PID        PID of the invoking agent
BRACT_AGENT_NAME       Name of the invoking agent
BRACT_AGENT_CWD        Working directory of the invoking agent
BRACT_STATE_DIR        Path to ~/.bract/agents/<pid>
BRACT_PLUGIN_NAME      Name of this plugin (from describe)
```

Plus the invoking agent's own environment variables (inherited).

## Optional: Daemon Mode

For high-frequency tools, plugins can optionally implement a long-running daemon mode to avoid per-call spawn overhead:

```
<plugin> daemon <socket-path>
```

The plugin should:
1. Listen on the Unix socket at `<socket-path>`
2. Accept connections and handle `invoke` calls over the socket using the same JSON protocol
3. Run until the socket is closed or SIGTERM is received

The runtime will use daemon mode automatically if a plugin responds to `daemon`:
1. Start with `<plugin> daemon /tmp/bract-<plugin>-<pid>.sock`
2. Subsequent invocations use the socket, skipping the spawn cost
3. On agent shutdown, the socket is closed

Daemon mode is optional. Plugins that don't support it work fine via subprocess.

## Discovery

The runtime discovers plugins by scanning these directories in order:

1. `.bract/plugins/` in the agent's working directory
2. `~/.bract/plugins/`

A plugin in `.bract/plugins/` overrides one with the same name in `~/.bract/plugins/`.

An executable is recognized as a bract plugin if:
- It responds to `<executable> describe` with valid JSON containing `name`, `description`, and `input_schema`
- The `input_schema` is a valid JSON Schema object

Plugins are re-discovered when an agent is spawned or reloaded. Caching is per-agent-session.

## Security

Plugins run with the invoking user's full permissions. There is no sandboxing by default.

Best practices:
- Review plugins before installing them
- Prefer single-file scripts over complex dependencies
- Don't install plugins from untrusted sources
- Consider using `.bract/plugins/` for project-specific tools to keep scope clear

Future: optional seccomp/Landlock sandbox via `--sandbox` flag.

## Versioning

The `describe` output may include an optional `version` field:

```json
{
  "name": "search",
  "version": "1.2.0",
  "description": "...",
  "input_schema": {...}
}
```

The runtime logs version information but does not enforce compatibility. If a plugin changes its schema in an incompatible way, the agent will receive an error on next invocation.

## Testing

Use `bract plugin test <name>` for interactive testing:

```bash
$ bract plugin test search
> {"query": "test query"}
{"status":"ok","result":[{"title":"...","url":"..."}]}

> {"query": "another test", "num_results": 3}
{"status":"ok","result":[...]}
```

Or test directly from the shell:

```bash
# Test describe
$ bract-search describe | jq .

# Test invoke
$ echo '{"query": "hello world"}' | bract-search invoke | jq .
```
