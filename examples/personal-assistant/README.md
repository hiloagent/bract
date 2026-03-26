# Example: Personal Assistant with Memory

A single persistent agent that remembers user preferences and ongoing context
across conversations.

## What this demonstrates

- Seeding agent memory at startup (`memory.seed`)
- Memory injection into the system prompt (`memory.inject: all`)
- An agent that reads and writes its own memory via built-in tools
- Persistent context that survives agent restarts

## Setup

```sh
# 1. Set your API key
export ANTHROPIC_API_KEY=sk-...

# 2. Start the agent
cd examples/personal-assistant
bract up

# 3. Send it a message
bract send assistant "What's on my plate this week?"

# 4. The agent reads its memory and responds with context
bract read assistant
```

## Watching memory evolve

After a few conversations, watch the memory directory grow:

```sh
# See what the agent remembers
bract memory assistant

# Read a specific memory
bract memory assistant preferences

# The agent may have written new memories on its own
ls ~/.bract/agents/assistant/memory/
```

## Injecting context manually

```sh
# Add a project brief so the agent knows what you're working on
cat > project.md << 'EOF'
---
key: current-project
updated: 2026-03-26T05:00:00Z
---

Working on bract — a local-first agent runtime.
Status: design phase. ADRs 1-8 written. Runtime packages in progress.
Next: implement AgentSpawner and Pipe engine.
EOF

bract memory assistant current-project --write < project.md

# Now the agent knows your project context
bract send assistant "What should I work on next?"
```

## Restarting without losing context

```sh
# Kill the agent
bract kill assistant

# Restart — memory is preserved on disk
bract spawn assistant --model anthropic/claude-sonnet-4-6

# Agent picks up right where it left off
bract send assistant "Continue where we left off"
bract read assistant
# → Agent references previous context from memory
```

## Memory directory after a week

```
~/.bract/agents/assistant/memory/
  preferences.md           ← seeded at start, maybe updated
  current-project.md       ← injected manually
  recent-decisions.md      ← agent wrote this
  weekly-goals.md          ← agent wrote this after you mentioned goals
  people.md                ← agent wrote this after you mentioned colleagues
```

Everything is editable. If the agent got something wrong, open the file and fix it.
