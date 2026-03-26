# Example 03: Agent Team

A team of specialized agents collaborating on a complex task.

## Scenario

Build a weekly digest: one agent gathers news, one analyzes trends, one writes the digest.

## Setup

```bash
# Spawn the team
$ SCOUT=$(bract spawn --name scout \
    --prompt prompts/news-scout.md \
    --tools search,browse \
    --model claude-haiku-4-5)    # cheap model for gathering

$ ANALYST=$(bract spawn --name analyst \
    --prompt prompts/trend-analyst.md \
    --model claude-sonnet-4-6)

$ EDITOR=$(bract spawn --name editor \
    --prompt prompts/digest-writer.md \
    --model claude-opus-4-6)    # best model for final output

# Wire them: scout → analyst → editor
$ bract pipe --detach $SCOUT $ANALYST
$ bract pipe --detach $ANALYST $EDITOR

# Create a group for easy status checks
$ bract group create --name digest-team $SCOUT $ANALYST $EDITOR
```

## Running

```bash
# Kick off the pipeline
$ bract write $SCOUT "Gather the top 20 AI/tech news stories from this week"

# Watch the team work
$ watch -n 2 bract ps

# After a few minutes, read the final digest
$ bract read --wait $EDITOR
```

## Team Status

```bash
$ bract group show digest-team

Group: digest-team
Members: 3

PID    NAME      STATUS    TASKS    LAST ACTIVITY
a1b2   scout     idle      5/5      45s ago
c3d4   analyst   idle      1/1      30s ago
f5e6   editor    idle      1/1      12s ago

$ bract read f5e6
# Weekly Tech Digest — March 26, 2026

## The Big Stories
...
```

## Persistent Team with Scheduling

Keep the team alive and trigger it weekly:

```bash
# Team is already running from above

# Schedule weekly trigger (every Monday at 9am)
$ bract schedule \
    --cron "0 9 * * 1" \
    --pid $SCOUT \
    --task "Gather the top 20 AI/tech news stories from this week"

$ bract schedules
ID     TYPE   EXPR          TARGET    NEXT
sched1 cron   0 9 * * 1     scout     Mon Apr 6 09:00
```

## Debugging the Team

```bash
# Something went wrong — check errors
$ bract tail --stderr $ANALYST

# See what the analyst has in memory
$ bract memory list $ANALYST
trends.md
previous_analyses.md

# Inject additional context
$ echo "Focus on open-source projects" > extra-context.md
$ bract memory inject $ANALYST extra-context.md

# Reload the analyst with updated prompt
$ vim prompts/trend-analyst.md
$ bract reload $ANALYST
```

## Teardown

```bash
# Graceful shutdown — agents save state before exiting
$ bract kill $SCOUT $ANALYST $EDITOR

# Or kill the group
$ bract kill --all

# Clean up state (keep recent exits)
$ bract gc --older 7
Removed 0 stale agents. 3 exited agents kept (exited within 7 days).
```
