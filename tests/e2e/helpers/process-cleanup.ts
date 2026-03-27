/**
 * Process tracking and cleanup helpers for e2e tests.
 * Tracks spawned PIDs so they can be killed at the end of each test.
 */
import { existsSync, readFileSync } from 'node:fs';

const tracked = new Set<number>();

/** Track a PID for cleanup. */
export function trackPid(pid: number): void {
  if (pid > 0) tracked.add(pid);
}

/** Read a PID from a file and track it. Returns null if file missing or invalid. */
export function trackPidFile(path: string): number | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8').trim();
  const pid = parseInt(raw, 10);
  if (isNaN(pid) || pid <= 0) return null;
  tracked.add(pid);
  return pid;
}

/** Kill all tracked PIDs with SIGTERM (best-effort). */
export function killAll(): void {
  for (const pid of tracked) {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already dead */ }
  }
  tracked.clear();
}

/** Kill all tracked PIDs with SIGKILL (best-effort). */
export function killAllForce(): void {
  for (const pid of tracked) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
  }
  tracked.clear();
}

/** Kill a specific PID. Returns true if the signal was sent. */
export function kill(pid: number, signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

/** Return true if a process with this PID is alive. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Wait up to `ms` milliseconds for the process to die. */
export async function waitForDeath(pid: number, ms = 5_000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await Bun.sleep(100);
  }
  return !isAlive(pid);
}

/** Wait up to `ms` for a file to appear. Returns true if it appeared. */
export async function waitForFile(path: string, ms = 10_000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (existsSync(path)) return true;
    await Bun.sleep(100);
  }
  return existsSync(path);
}

/** Wait up to `ms` for a file to contain a specific string. */
export async function waitForFileContent(
  path: string,
  content: string,
  ms = 10_000,
): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      const text = readFileSync(path, 'utf8').trim();
      if (text.includes(content)) return true;
    }
    await Bun.sleep(100);
  }
  return false;
}
