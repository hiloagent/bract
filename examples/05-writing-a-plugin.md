# Example 05: Writing a Plugin

Plugins are executables that follow a simple protocol: respond to `describe` and `invoke` commands with JSON.

## Minimal Example: `bract-echo`

The simplest possible plugin — echoes input back.

```bash
#!/usr/bin/env bash
# ~/.bract/plugins/bract-echo
# Make it executable: chmod +x ~/.bract/plugins/bract-echo

set -euo pipefail

case "${1:-help}" in
  describe)
    cat <<'EOF'
{
  "name": "echo",
  "description": "Echo a message back. Useful for testing.",
  "input_schema": {
    "type": "object",
    "properties": {
      "message": {
        "type": "string",
        "description": "The message to echo"
      }
    },
    "required": ["message"]
  }
}
EOF
    ;;

  invoke)
    INPUT=$(cat)
    MESSAGE=$(echo "$INPUT" | python3 -c "import json,sys; print(json.load(sys.stdin)['message'])")
    python3 -c "import json; print(json.dumps({'status':'ok','result':\"$MESSAGE\"}))"
    ;;

  *)
    echo "Usage: bract-echo [describe|invoke]" >&2
    exit 1
    ;;
esac
```

## Testing a Plugin

```bash
# Test describe
$ bract-echo describe
{"name":"echo","description":"Echo a message back...","input_schema":{...}}

# Test invoke
$ echo '{"message": "hello world"}' | bract-echo invoke
{"status":"ok","result":"hello world"}

# Test via bract
$ bract plugin describe echo
$ echo '{"message":"test"}' | bract plugin test echo
```

## Python Plugin: `bract-search`

A real search plugin using DuckDuckGo:

```python
#!/usr/bin/env python3
# ~/.bract/plugins/bract-search

import sys
import json
import urllib.request
import urllib.parse

SCHEMA = {
    "name": "search",
    "description": "Search the web using DuckDuckGo. Returns titles, URLs, and snippets.",
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "The search query"
            },
            "num_results": {
                "type": "integer",
                "description": "Number of results (default: 5, max: 10)",
                "default": 5
            }
        },
        "required": ["query"]
    }
}

def search(query, num_results=5):
    # DuckDuckGo instant answer API (no key required)
    params = urllib.parse.urlencode({
        "q": query,
        "format": "json",
        "no_html": 1,
        "skip_disambig": 1
    })
    url = f"https://api.duckduckgo.com/?{params}"

    with urllib.request.urlopen(url, timeout=10) as resp:
        data = json.loads(resp.read())

    results = []
    for item in data.get("RelatedTopics", [])[:num_results]:
        if "Text" in item and "FirstURL" in item:
            results.append({
                "title": item["Text"][:80],
                "url": item["FirstURL"],
                "snippet": item["Text"]
            })

    return results

def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "help"

    if cmd == "describe":
        print(json.dumps(SCHEMA))

    elif cmd == "invoke":
        try:
            inp = json.loads(sys.stdin.read())
            query = inp["query"]
            num = inp.get("num_results", 5)
            results = search(query, num)
            print(json.dumps({"status": "ok", "result": results}))
        except Exception as e:
            print(json.dumps({"status": "error", "error": str(e)}))

    else:
        print("Usage: bract-search [describe|invoke]", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
```

Install and test:
```bash
$ chmod +x ~/.bract/plugins/bract-search
$ bract plugin list
search    ~/.bract/plugins/bract-search    DuckDuckGo web search

$ echo '{"query": "bract agent runtime"}' | bract plugin test search
```

## Node.js Plugin: `bract-notify`

Send system notifications when an agent completes a task:

```javascript
#!/usr/bin/env node
// ~/.bract/plugins/bract-notify

const { execSync } = require('child_process')

const SCHEMA = {
  name: 'notify',
  description: 'Send a desktop notification',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Notification title' },
      message: { type: 'string', description: 'Notification body' },
      urgency: {
        type: 'string',
        enum: ['low', 'normal', 'critical'],
        default: 'normal'
      }
    },
    required: ['title', 'message']
  }
}

function notify(title, message, urgency = 'normal') {
  // Use notify-send on Linux, osascript on macOS
  const platform = process.platform
  try {
    if (platform === 'linux') {
      execSync(`notify-send -u ${urgency} "${title}" "${message}"`)
    } else if (platform === 'darwin') {
      execSync(`osascript -e 'display notification "${message}" with title "${title}"'`)
    }
    return { sent: true }
  } catch (err) {
    return { sent: false, reason: err.message }
  }
}

const cmd = process.argv[2]

if (cmd === 'describe') {
  console.log(JSON.stringify(SCHEMA))
} else if (cmd === 'invoke') {
  let input = ''
  process.stdin.on('data', d => input += d)
  process.stdin.on('end', () => {
    const { title, message, urgency } = JSON.parse(input)
    const result = notify(title, message, urgency)
    console.log(JSON.stringify({ status: 'ok', result }))
  })
} else {
  process.stderr.write('Usage: bract-notify [describe|invoke]\n')
  process.exit(1)
}
```

## Plugin with Streaming Progress

For long operations, emit progress lines before the final result:

```python
#!/usr/bin/env python3
# bract-browse — fetch and extract web page content

import sys, json, time

def browse(url):
    # Emit progress (NDJSON format)
    print(json.dumps({"type": "progress", "message": f"Fetching {url}..."}), flush=True)
    time.sleep(0.5)  # actual fetch would go here

    print(json.dumps({"type": "progress", "message": "Extracting text content..."}), flush=True)
    time.sleep(0.3)

    # Final result
    return {
        "status": "ok",
        "result": {
            "url": url,
            "title": "Example Page",
            "text": "Page content here..."
        }
    }

if sys.argv[1] == "invoke":
    inp = json.loads(sys.stdin.read())
    result = browse(inp["url"])
    print(json.dumps(result), flush=True)
```

## Project-local Plugin

For project-specific tools, put them in `.bract/plugins/`:

```
my-project/
├── .bract/
│   └── plugins/
│       └── run-tests    # runs the project's test suite
├── src/
└── tests/
```

```bash
#!/usr/bin/env bash
# my-project/.bract/plugins/run-tests

case "${1:-help}" in
  describe)
    echo '{"name":"run_tests","description":"Run the project test suite","input_schema":{"type":"object","properties":{"filter":{"type":"string","description":"Optional test name filter"}},"required":[]}}'
    ;;
  invoke)
    FILTER=$(cat | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('filter',''))")
    cd "$(dirname "$0")/../.."  # project root
    if OUTPUT=$(npm test -- --grep "$FILTER" 2>&1); then
      echo "{\"status\":\"ok\",\"result\":$(echo "$OUTPUT" | python3 -c "import json,sys; print(json.dumps(sys.stdin.read()))")}"
    else
      echo "{\"status\":\"error\",\"error\":$(echo "$OUTPUT" | python3 -c "import json,sys; print(json.dumps(sys.stdin.read()))")}"
    fi
    ;;
esac
```
