# Example: Research Fleet

Four agents running on a single machine with a 12GB GPU. Two lightweight 3B models
handle triage and notifications; one 9B model does the heavy thinking.

## Setup

```sh
# 1. Clone and enter
git clone https://github.com/hiloagent/bract
cd examples/research-fleet

# 2. Set your env vars
cp .env.example .env
# edit .env with your Telegram token + chat ID

# 3. Start the fleet
bract up

# 4. Watch it run
bract ps
```

## What happens

```
Every hour:
  news-monitor wakes up
    → fetches headlines
    → writes summary to outbox

  inbox-triage reads news-monitor outbox
    → routine items → archived
    → research-worthy items → forwarded to deep-researcher
    → urgent items → forwarded to deep-researcher AND notify

  deep-researcher reads inbox-triage outbox
    → fetches full sources
    → writes detailed analysis to outbox

  notify reads inbox-triage outbox (urgent only)
    → sends Telegram message to Lo
```

## Observe it

```sh
# See all agents and their status
bract ps

# Watch news-monitor process a scan in real time
bract log news-monitor --follow

# Read the latest deep research output
bract read deep-researcher --latest

# Check what's waiting in an inbox
bract inbox deep-researcher

# Send a manual research request
bract send deep-researcher "Research the latest developments in Solana L2s"
```

## VRAM usage

| Agent          | Model        | VRAM  | Notes                          |
|----------------|--------------|-------|--------------------------------|
| news-monitor   | qwen2.5:3b   | ~2GB  | Resident, wakes hourly         |
| inbox-triage   | qwen2.5:3b   | ~2GB  | Shared instance with monitor   |
| deep-researcher| qwen3.5:9b   | ~6GB  | Loads on demand, stays warm    |
| notify         | qwen2.5:3b   | ~2GB  | Shared instance                |

Total peak: ~8GB. Fits comfortably on RTX 3060 12GB.

## File structure after running overnight

```
~/.bract/agents/
  news-monitor/
    status                    ← "idle"
    inbox/                    ← empty (processed)
    outbox/
      1742900000000-01HX.msg  ← last scan summary
    logs/
      2026-03-25.ndjson       ← full activity log

  deep-researcher/
    status                    ← "idle"
    inbox/                    ← empty (processed)
    outbox/
      1742910000000-01HY.msg  ← Iran conflict analysis (written 2am)
      1742920000000-01HZ.msg  ← Zettelkasten paper summary (written 4am)
    logs/
      2026-03-25.ndjson
```

Everything is a file. Read it with `cat`. Search it with `grep`. No app needed.
