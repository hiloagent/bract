/**
 * @file index.ts
 * Public API for @losoft/bract-runtime.
 *
 * Re-exports all stable public types and functions. Import from this module
 * rather than from individual source files for forward-compatibility.
 *
 * @module @losoft/bract-runtime
 */
export { ProcessTable } from './process-table.js';
export type { AgentEntry, AgentStatus } from './process-table.js';

export { send, reply, listPending, read, consume } from './message.js';
export type { Message } from './message.js';

export { InboxWatcher } from './inbox-watcher.js';
export type { InboxWatcherOptions, MessageEvent, InboxErrorEvent } from './inbox-watcher.js';

export { PipeRouter } from './pipe-router.js';
export type { PipeDef, PipeRouterOptions } from './pipe-router.js';

export { JoinRouter } from './join-router.js';
export type { JoinPipeDef, JoinRouterOptions } from './join-router.js';
