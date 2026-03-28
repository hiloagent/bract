/**
 * @file home.ts
 * Resolves BRACT_HOME — the root directory for all agent state.
 * Checks (in order): explicit --home flag, $BRACT_HOME env var, ~/.bract default.
 * @module @losoft/bract-cli/home
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Resolve BRACT_HOME from env or fall back to ~/.bract.
 * --home <path> flag (already stripped from argv by the dispatcher) can
 * override via the HOME_OVERRIDE module-level variable set before import.
 */
/**
 * Resolve BRACT_HOME with precedence:
 *   1. --home flag (override param)
 *   2. $BRACT_HOME env var
 *   3. home: field from bract.yml (configHome param)
 *   4. ~/.bract default
 */
export function resolveBractHome(override?: string, configHome?: string): string {
  return override ?? process.env.BRACT_HOME ?? configHome ?? join(homedir(), '.bract');
}
