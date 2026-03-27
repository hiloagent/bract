# @losoft/bract-supervisor

Process supervisor for [bract](https://github.com/hiloagent/bract) agents. Watches running agents, detects crashes, and restarts them with configurable backoff.

Used internally by `bract up`, but can be imported directly to embed supervision in your own orchestration code.

## Install

```bash
npm install @losoft/bract-supervisor
# or
bun add @losoft/bract-supervisor
```

## Usage

```ts
import { Supervisor } from '@losoft/bract-supervisor';
import { ProcessTable } from '@losoft/bract-runtime';

const home = '/home/user/.bract';

const supervisor = new Supervisor(home, {
  heartbeatIntervalMs: 5000,  // how often to check agent health (default: 5000)
  maxRestarts: 10,            // max restarts before giving up (default: 10)
  resetWindowMs: 60_000,      // window over which maxRestarts is counted (default: 60000)
  baseDelayMs: 1000,          // initial backoff delay (default: 1000)
  maxDelayMs: 30_000,         // maximum backoff delay (default: 30000)
});

// Register an agent with a spawn callback
supervisor.register({
  name: 'assistant',
  restart: 'on-failure',  // 'always' | 'on-failure' | 'never'
  spawn: async () => {
    const proc = Bun.spawn(['bract', 'spawn', 'assistant', '--detach']);
    return proc.pid;
  },
});

supervisor.on('agentDied', ({ name, pid, exitCode }) => {
  console.log(`${name} died (pid ${pid}, exit ${exitCode})`);
});

supervisor.on('agentRestarted', ({ name, newPid, restartCount }) => {
  console.log(`${name} restarted as pid ${newPid} (attempt ${restartCount})`);
});

supervisor.on('agentExhausted', ({ name, restartCount }) => {
  console.error(`${name} exceeded max restarts (${restartCount}) — giving up`);
});

supervisor.start();

// Graceful shutdown
process.on('SIGTERM', () => supervisor.stop());
```

## Restart policies

| Policy | Behaviour |
|---|---|
| `always` | Restart regardless of exit code |
| `on-failure` | Restart only on non-zero exit (default) |
| `never` | Never restart |

## Backoff

Restarts use exponential backoff with jitter. The delay after the _n_-th restart is:

```
delay = min(baseDelayMs * 2^n, maxDelayMs) * (0.5 + random * 0.5)
```

The restart counter resets after the agent has been running cleanly for `resetWindowMs`.

## License

MIT
