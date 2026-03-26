# Example 01: Hello Agent

The simplest possible bract session.

## Spawn, write, read

```bash
# Spawn a persistent agent
$ bract spawn --name hello
7a2f

# Send it a question
$ bract write 7a2f "What is 2 + 2?"

# Read the answer
$ bract read 7a2f
4

# Check it's still running
$ bract ps
PID    NAME    STATUS    MODEL                  UPTIME   TASKS
7a2f   hello   idle      claude-sonnet-4-6      0m12s    1/1

# Kill it when done
$ bract kill 7a2f
```

## One-shot with bract run

For quick tasks, don't bother spawning:

```bash
$ echo "What is 2 + 2?" | bract run
4
```

## Piping

```bash
$ echo "What is the capital of France?" | bract run
Paris

# Pipe the result into another agent
$ echo "What is the capital of France?" \
  | bract run \
  | bract run --prompt prompts/elaborate.md
Paris is the capital of France, situated on the Seine River...
```

## Interactive session

```bash
# Spawn an agent and write to it interactively
$ PID=$(bract spawn --name chat)
$ while read -p "You: " line; do
    echo "$line" | bract write --wait "$PID"
    bract read "$PID"
  done
You: Hello
Hi! How can I help you today?
You: What's the weather like?
I don't have access to real-time weather data...
```
