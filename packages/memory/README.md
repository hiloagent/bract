# @losoft/bract-memory

Filesystem-backed memory store for [bract](https://github.com/hiloagent/bract) agents. Provides read, write, append, replace, search, and glob operations over a keyed file directory.

Used by the bract CLI to give agents persistent memory across conversations.

## Install

```bash
npm install @losoft/bract-memory
# or
bun add @losoft/bract-memory
```

## Usage

```ts
import {
  memoryRead,
  memoryWrite,
  memoryAppend,
  memoryReplace,
  memoryGrep,
  memoryGlob,
  memoryDelete,
} from '@losoft/bract-memory';

const memDir = '/home/user/.bract/agents/assistant/memory';

// Write a file
await memoryWrite(memDir, 'notes.md', '# Notes\n\nFirst entry.\n');

// Read it back (optionally slice by line range)
const content = await memoryRead(memDir, 'notes.md');
const slice   = await memoryRead(memDir, 'notes.md', 1, 5); // lines 1–5

// Append to a file
await memoryAppend(memDir, 'notes.md', '\nSecond entry.\n');

// Replace a string in a file
await memoryReplace(memDir, 'notes.md', 'First entry.', 'Updated entry.');

// Search across all memory files
const matches = await memoryGrep(memDir, 'entry');
// [{ key: 'notes.md', matches: [{ line: 3, text: 'Updated entry.' }] }]

// List files matching a glob pattern
const keys = await memoryGlob(memDir, '*.md');
// ['notes.md']

// Delete a file
await memoryDelete(memDir, 'notes.md');
```

## API

| Function | Description |
|---|---|
| `memoryRead(dir, key, start?, end?)` | Read a file, optionally slice by line range |
| `memoryWrite(dir, key, content)` | Write (overwrite) a file |
| `memoryAppend(dir, key, content)` | Append to a file |
| `memoryReplace(dir, key, old, new)` | Replace a string in a file |
| `memoryGrep(dir, pattern)` | Search all files with a regex pattern |
| `memoryGlob(dir, pattern)` | List files matching a glob pattern |
| `memoryDelete(dir, key)` | Delete a file |

Keys are relative paths — subdirectories are supported (`'context/user.md'`).

## License

MIT
