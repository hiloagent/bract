# @losoft/bract-runtime

Core runtime primitives for [bract](https://github.com/hiloagent/bract) — the lightweight multi-agent framework.

Provides the filesystem abstractions that all bract packages build on: agent process tracking, inbox/outbox messaging, and message routing between agents.

## Install

```bash
npm install @losoft/bract-runtime
# or
bun add @losoft/bract-runtime
```

## API

### ProcessTable

Tracks agent state on disk under `$BRACT_HOME/agents/<name>/`.

```ts
import { ProcessTable } from '@losoft/bract-runtime';

const pt = new ProcessTable('/home/user/.bract');

pt.register('assistant', 'claude-3-5-haiku');
pt.setRunning('assistant', process.pid);
pt.setDead('assistant');

const agents = pt.list();
// [{ name: 'assistant', status: 'dead', pid: null, model: 'claude-3-5-haiku', ... }]
```

**Types:** `AgentStatus = 'running' | 'idle' | 'dead' | 'error' | 'restarting'`, `AgentEntry`

---

### Messaging

Low-level send/read functions for agent inboxes and outboxes.

```ts
import { send, reply, listPending, read, consume } from '@losoft/bract-runtime';

const home = '/home/user/.bract';

// Send a message to an agent's inbox
send(home, 'assistant', 'What is 2 + 2?');

// List pending inbox message IDs
const ids = listPending(`${home}/agents/assistant/inbox`);

// Read a message without removing it
const msg = read(`${home}/agents/assistant/inbox`, ids[0]);

// Read and delete a message
const msg2 = consume(`${home}/agents/assistant/inbox`, ids[0]);

// Reply from within an agent
reply(home, 'assistant', messageId, 'The answer is 4.');
```

**Type:** `Message { v, id, from, body, ts }`

---

### InboxWatcher

Watches an agent's inbox directory and emits events as messages arrive.

```ts
import { InboxWatcher } from '@losoft/bract-runtime';

const watcher = new InboxWatcher({
  inboxDir: '/home/user/.bract/agents/assistant/inbox',
  pollIntervalMs: 500, // default
});

watcher.on('message', ({ messageId, message }) => {
  console.log('new message:', message.body);
});

watcher.on('error', ({ error }) => console.error(error));

watcher.start();
// watcher.stop();
```

---

### PipeRouter

Routes outbox messages to target agent inboxes based on a pipe configuration.

```ts
import { PipeRouter } from '@losoft/bract-runtime';

const router = new PipeRouter({
  home: '/home/user/.bract',
  pipes: [{ from: 'planner', to: 'executor' }],
});

router.start();
```

## License

MIT
