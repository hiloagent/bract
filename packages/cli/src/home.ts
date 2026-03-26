import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Resolve BRACT_HOME from env or fall back to ~/.bract.
 * --home <path> flag (already stripped from argv by the dispatcher) can
 * override via the HOME_OVERRIDE module-level variable set before import.
 */
export function resolveBractHome(override?: string): string {
  return override ?? process.env.BRACT_HOME ?? join(homedir(), '.bract');
}
