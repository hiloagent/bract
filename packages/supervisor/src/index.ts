/**
 * @file index.ts
 * Public API for @losoft/bract-supervisor.
 * @module @losoft/bract-supervisor
 */
export { Supervisor } from './supervisor.js';
export type {
  AgentRegistration,
  RestartPolicy,
  SupervisorOptions,
  AgentDiedEvent,
  AgentRestartedEvent,
  AgentExhaustedEvent,
} from './supervisor.js';

export { computeBackoff } from './backoff.js';
export type { BackoffOptions } from './backoff.js';

export { writeCrashRecord } from './crash-record.js';
export type { CrashRecord } from './crash-record.js';
