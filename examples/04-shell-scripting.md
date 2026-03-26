# Example 04: Shell Scripting with bract

bract is designed to work with shell scripts. Agents are processes; you can use all the usual Unix tools.

## Basic Script

```bash
#!/usr/bin/env bash
# analyze-logs.sh — analyze error logs with an LLM

LOG_FILE="${1:-/var/log/app.log}"

if [[ ! -f "$LOG_FILE" ]]; then
  echo "Usage: $0 <log-file>" >&2
  exit 1
fi

# Extract recent errors and pipe to an agent
tail -n 1000 "$LOG_FILE" \
  | grep -i "error\|exception\|fatal" \
  | bract run --model claude-sonnet-4-6 \
      --prompt "Analyze these error log lines. Group similar errors, identify root causes, and suggest fixes." \
  > analysis.md

echo "Analysis written to analysis.md"
```

## Processing Files in a Loop

```bash
#!/usr/bin/env bash
# translate-docs.sh — translate documentation files to Spanish

TARGET_LANG="${1:-Spanish}"
OUTPUT_DIR="docs_${TARGET_LANG,,}"
mkdir -p "$OUTPUT_DIR"

for file in docs/*.md; do
  filename=$(basename "$file")
  echo "Translating $filename..."

  cat "$file" \
    | bract run \
        --prompt "Translate this markdown document to $TARGET_LANG. Preserve all markdown formatting, code blocks, and links. Output only the translated document." \
        --no-tools \
    > "$OUTPUT_DIR/$filename"

  echo "  → $OUTPUT_DIR/$filename"
done

echo "Done. Translated $(ls $OUTPUT_DIR | wc -l) files."
```

## Using jq with Agent Output

```bash
#!/usr/bin/env bash
# extract-tasks.sh — extract action items from meeting notes

NOTES_FILE="$1"

# Get structured output from the agent
TASKS=$(cat "$NOTES_FILE" \
  | bract run \
      --prompt 'Extract all action items from these meeting notes.
                Return a JSON array of objects: {task, owner, due_date, priority}.
                Return only valid JSON, no other text.' \
      --no-tools)

# Process with jq
echo "High priority tasks:"
echo "$TASKS" | jq -r '.[] | select(.priority == "high") | "  • \(.task) — \(.owner)"'

echo ""
echo "All tasks by owner:"
echo "$TASKS" | jq -r 'group_by(.owner)[] | "\(.[0].owner):", (.[] | "  - \(.task)")'
```

## Watch Mode

```bash
#!/usr/bin/env bash
# monitor-inbox.sh — monitor a directory and process new files

WATCH_DIR="${1:-./inbox}"
AGENT_PID=$(bract spawn --name file-processor --prompt prompts/process-file.md)

echo "Monitoring $WATCH_DIR with agent $AGENT_PID"
echo "Agent output: bract tail $AGENT_PID"

# Process existing files
for file in "$WATCH_DIR"/*; do
  [[ -f "$file" ]] && cat "$file" | bract write "$AGENT_PID"
done

# Watch for new files (requires inotify-tools)
inotifywait -m -e close_write "$WATCH_DIR" | while read -r dir event file; do
  echo "New file: $file"
  cat "$WATCH_DIR/$file" | bract write "$AGENT_PID"
done
```

## Exit Codes in Scripts

```bash
#!/usr/bin/env bash
# validate-code.sh — use an agent to validate code quality

set -euo pipefail

result=$(cat "$1" | bract run \
  --prompt "Review this code for bugs and security issues.
            If you find critical issues, exit with code 1.
            If only minor issues, exit with code 0.
            Print a brief summary of findings.")

exit_code=$?

echo "$result"

if [[ $exit_code -ne 0 ]]; then
  echo "⚠ Critical issues found. Blocking commit." >&2
  exit 1
fi
```

## Environment Variables

```bash
# Pass context to agents via environment
export PROJECT_NAME="bract"
export CODING_STYLE="functional, avoid OOP"
export LANGUAGE="TypeScript"

bract spawn \
  --name coder \
  --env "PROJECT_NAME=$PROJECT_NAME" \
  --env "CODING_STYLE=$CODING_STYLE" \
  --env "LANGUAGE=$LANGUAGE" \
  --prompt prompts/coder.md

# The agent can read these via its env file:
# cat ~/.bract/agents/<pid>/env
```

## Parallel Agents

```bash
#!/usr/bin/env bash
# parallel-analysis.sh — analyze multiple files in parallel

FILES=("report1.pdf" "report2.pdf" "report3.pdf")
PIDS=()

# Spawn one agent per file
for file in "${FILES[@]}"; do
  PID=$(bract spawn --name "analyzer-$file" \
    --prompt prompts/report-analyzer.md)
  PIDS+=("$PID")
  cat "$file" | bract write "$PID"
done

# Wait for all agents to complete
for PID in "${PIDS[@]}"; do
  bract read --wait "$PID" >> combined-analysis.md
  bract kill "$PID"
done

echo "Combined analysis: combined-analysis.md"
```
