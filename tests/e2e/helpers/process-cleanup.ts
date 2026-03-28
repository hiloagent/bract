/**
 * @file helpers/process-cleanup.ts
 * Tracks spawned PIDs and ensures they are killed after tests.
 * Prevents orphaned processes in CI.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const trackedPids = new Set<number>();

/** Track a PID for cleanup */
export function trackPid(pid: number): void {
  trackedPids.add(pid);
}

/** Read and track a PID from a bract agent's pid file */
export function trackAgentPid(home: string, agentName: string): number | null {
  const pidFile = join(home, 'agents', agentName, 'pid');
  if (!existsSync(pidFile)) return null;
  const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
  if (isNaN(pid)) return null;
  trackPid(pid);
  return pid;
}

/** Read and track the supervisor PID */
export function trackSupervisorPid(home: string): number | null {
  const pidFile = join(home, 'supervisor.pid');
  if (!existsSync(pidFile)) return null;
  const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
  if (isNaN(pid)) return null;
  trackPid(pid);
  return pid;
}

/** Kill all tracked PIDs, ignoring errors for already-dead processes */
export function killAll(): void {
  for (const pid of trackedPids) {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already dead */ }
  }
  trackedPids.clear();
}

/** Check if a PID is still alive */
export function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Wait up to timeoutMs for a PID to die */
export async function waitForDeath(pid: number, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await Bun.sleep(100);
  }
  return false;
}

/** Wait up to timeoutMs for a file to appear */
export async function waitForFile(path: string, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return true;
    await Bun.sleep(100);
  }
  return false;
}
