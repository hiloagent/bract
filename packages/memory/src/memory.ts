/**
 * @file memory.ts
 * Memory tools — plain async functions for reading and writing agent memory files.
 *
 * All keys are treated as relative paths within the memory directory.
 * Keys that resolve outside the memory directory are rejected to prevent path traversal.
 *
 * @module @losoft/bract-memory/memory
 */
import { join, resolve, relative } from 'node:path';
import { mkdir, unlink, readdir } from 'node:fs/promises';

/** Resolve a key to an absolute file path, ensuring it stays within memoryDir. */
function resolvePath(memoryDir: string, key: string): string {
  if (key.startsWith('/')) {
    throw new Error(`Memory key "${key}" resolves outside memory directory`);
  }
  const abs = resolve(join(memoryDir, key));
  const rel = relative(memoryDir, abs);
  if (rel.startsWith('..') || rel === '') {
    throw new Error(`Memory key "${key}" resolves outside memory directory`);
  }
  return abs;
}

/** Ensure the memory directory (and any subdirectories for the key) exists. */
async function ensureDir(filePath: string): Promise<void> {
  const dir = filePath.substring(0, filePath.lastIndexOf('/'));
  await mkdir(dir, { recursive: true });
}

/**
 * Read a memory file. Returns the full content or a line range if start/end provided.
 * Line numbers are 1-based and inclusive.
 */
export async function memoryRead(
  memoryDir: string,
  key: string,
  start?: number,
  end?: number,
): Promise<string> {
  const filePath = resolvePath(memoryDir, key);
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    throw new Error(`Memory key "${key}" not found`);
  }
  const text = await file.text();

  if (start === undefined && end === undefined) return text;

  const lines = text.split('\n');
  const from = Math.max(1, start ?? 1) - 1;
  const to = end !== undefined ? Math.min(end, lines.length) : lines.length;
  const slice = lines.slice(from, to).join('\n');
  return `lines ${from + 1}-${to} of ${key}:\n${slice}`;
}

/** Create or overwrite a memory file. */
export async function memoryWrite(
  memoryDir: string,
  key: string,
  content: string,
): Promise<void> {
  const filePath = resolvePath(memoryDir, key);
  await ensureDir(filePath);
  await Bun.write(filePath, content);
}

/** Append content to a memory file, creating it if it does not exist. */
export async function memoryAppend(
  memoryDir: string,
  key: string,
  content: string,
): Promise<void> {
  const filePath = resolvePath(memoryDir, key);
  await ensureDir(filePath);
  const file = Bun.file(filePath);
  const existing = (await file.exists()) ? await file.text() : '';
  await Bun.write(filePath, existing + content);
}

/** Find-and-replace within a memory file. Throws if oldStr is not found. */
export async function memoryReplace(
  memoryDir: string,
  key: string,
  oldStr: string,
  newStr: string,
): Promise<void> {
  const filePath = resolvePath(memoryDir, key);
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    throw new Error(`Memory key "${key}" not found`);
  }
  const text = await file.text();
  if (!text.includes(oldStr)) {
    throw new Error(`String not found in "${key}"`);
  }
  await Bun.write(filePath, text.replace(oldStr, newStr));
}

export interface GrepMatch {
  /** Memory key (relative path). */
  key: string;
  /** Lines that matched, with 1-based line numbers. */
  matches: Array<{ line: number; text: string }>;
}

/** Search across all memory files by content. Pattern is treated as a regex. */
export async function memoryGrep(
  memoryDir: string,
  pattern: string,
): Promise<GrepMatch[]> {
  const re = new RegExp(pattern);
  const results: GrepMatch[] = [];

  async function scan(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return; // directory doesn't exist yet
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      const file = Bun.file(full);
      if (!(await file.exists())) continue;

      const text = await file.text();
      const lines = text.split('\n');
      const matches: Array<{ line: number; text: string }> = [];
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i] ?? '')) {
          matches.push({ line: i + 1, text: lines[i] ?? '' });
        }
      }
      if (matches.length > 0) {
        const key = relative(memoryDir, full);
        results.push({ key, matches });
      }
    }
  }

  await scan(memoryDir);
  return results;
}

/** Find memory files by filename pattern. Use '*' to list all. */
export async function memoryGlob(
  memoryDir: string,
  pattern: string,
): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(memoryDir);
  } catch {
    return [];
  }

  if (pattern === '*') return entries;

  // Convert glob to regex: escape everything except * which becomes .*
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  const re = new RegExp(`^${regexStr}$`);
  return entries.filter((e) => re.test(e));
}

/** Remove a memory file. Throws if the key does not exist. */
export async function memoryDelete(
  memoryDir: string,
  key: string,
): Promise<void> {
  const filePath = resolvePath(memoryDir, key);
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    throw new Error(`Memory key "${key}" not found`);
  }
  await unlink(filePath);
}
