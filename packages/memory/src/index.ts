/**
 * @file index.ts
 * Public API for @losoft/bract-memory.
 *
 * @module @losoft/bract-memory
 */
export {
  memoryRead,
  memoryWrite,
  memoryAppend,
  memoryReplace,
  memoryGrep,
  memoryGlob,
  memoryDelete,
} from './memory.js';
export type { GrepMatch } from './memory.js';
