/**
 * @file memory.test.ts
 * Tests for memory tools.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  memoryRead,
  memoryWrite,
  memoryAppend,
  memoryReplace,
  memoryGrep,
  memoryGlob,
  memoryDelete,
} from './memory.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bract-memory-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('memoryWrite + memoryRead', () => {
  it('writes a file and reads it back', async () => {
    await memoryWrite(dir, 'note.md', 'hello world\n');
    const content = await memoryRead(dir, 'note.md');
    expect(content).toBe('hello world\n');
  });

  it('overwrites an existing file', async () => {
    await memoryWrite(dir, 'note.md', 'first\n');
    await memoryWrite(dir, 'note.md', 'second\n');
    expect(await memoryRead(dir, 'note.md')).toBe('second\n');
  });

  it('creates parent directories as needed', async () => {
    await memoryWrite(dir, 'sub/dir/note.md', 'nested\n');
    expect(await memoryRead(dir, 'sub/dir/note.md')).toBe('nested\n');
  });

  it('throws when reading a missing key', async () => {
    await expect(memoryRead(dir, 'missing.md')).rejects.toThrow('not found');
  });

  it('reads a line range (1-based, inclusive)', async () => {
    const lines = ['line1', 'line2', 'line3', 'line4', 'line5'].join('\n');
    await memoryWrite(dir, 'multi.md', lines);
    const slice = await memoryRead(dir, 'multi.md', 2, 4);
    expect(slice).toContain('line2');
    expect(slice).toContain('line3');
    expect(slice).toContain('line4');
    expect(slice).not.toContain('line1');
    expect(slice).not.toContain('line5');
  });
});

describe('memoryAppend', () => {
  it('creates a file if it does not exist', async () => {
    await memoryAppend(dir, 'log.md', 'entry1\n');
    expect(await memoryRead(dir, 'log.md')).toBe('entry1\n');
  });

  it('appends to an existing file', async () => {
    await memoryWrite(dir, 'log.md', 'entry1\n');
    await memoryAppend(dir, 'log.md', 'entry2\n');
    expect(await memoryRead(dir, 'log.md')).toBe('entry1\nentry2\n');
  });
});

describe('memoryReplace', () => {
  it('replaces the first occurrence of a string', async () => {
    await memoryWrite(dir, 'doc.md', 'foo bar foo\n');
    await memoryReplace(dir, 'doc.md', 'foo', 'baz');
    expect(await memoryRead(dir, 'doc.md')).toBe('baz bar foo\n');
  });

  it('throws when the old string is not found', async () => {
    await memoryWrite(dir, 'doc.md', 'hello\n');
    await expect(memoryReplace(dir, 'doc.md', 'missing', 'x')).rejects.toThrow(
      'String not found',
    );
  });

  it('throws when the key does not exist', async () => {
    await expect(memoryReplace(dir, 'ghost.md', 'a', 'b')).rejects.toThrow(
      'not found',
    );
  });
});

describe('memoryGrep', () => {
  it('returns matches across files', async () => {
    await memoryWrite(dir, 'a.md', 'hello world\n');
    await memoryWrite(dir, 'b.md', 'goodbye world\nno match here\n');
    const results = await memoryGrep(dir, 'world');
    expect(results).toHaveLength(2);
    const keys = results.map((r) => r.key).sort();
    expect(keys).toEqual(['a.md', 'b.md']);
  });

  it('returns an empty array when nothing matches', async () => {
    await memoryWrite(dir, 'a.md', 'hello\n');
    const results = await memoryGrep(dir, 'zzznomatch');
    expect(results).toHaveLength(0);
  });

  it('returns an empty array when memory dir is empty', async () => {
    const results = await memoryGrep(dir, 'anything');
    expect(results).toHaveLength(0);
  });

  it('includes correct line numbers', async () => {
    await memoryWrite(dir, 'lines.md', 'alpha\nbeta\ngamma\n');
    const results = await memoryGrep(dir, 'beta');
    expect(results[0]?.matches[0]?.line).toBe(2);
  });
});

describe('memoryGlob', () => {
  it("lists all files with '*'", async () => {
    await memoryWrite(dir, 'a.md', '');
    await memoryWrite(dir, 'b.md', '');
    const files = await memoryGlob(dir, '*');
    expect(files.sort()).toEqual(['a.md', 'b.md']);
  });

  it('filters by pattern', async () => {
    await memoryWrite(dir, 'notes.md', '');
    await memoryWrite(dir, 'tasks.md', '');
    await memoryWrite(dir, 'log.txt', '');
    const files = await memoryGlob(dir, '*.md');
    expect(files.sort()).toEqual(['notes.md', 'tasks.md']);
  });

  it('returns an empty array when no files match', async () => {
    await memoryWrite(dir, 'file.txt', '');
    expect(await memoryGlob(dir, '*.md')).toEqual([]);
  });

  it('returns an empty array when memory dir does not exist', async () => {
    expect(await memoryGlob('/nonexistent/dir', '*')).toEqual([]);
  });
});

describe('memoryDelete', () => {
  it('deletes an existing file', async () => {
    await memoryWrite(dir, 'temp.md', 'data\n');
    await memoryDelete(dir, 'temp.md');
    await expect(memoryRead(dir, 'temp.md')).rejects.toThrow('not found');
  });

  it('throws when the key does not exist', async () => {
    await expect(memoryDelete(dir, 'ghost.md')).rejects.toThrow('not found');
  });
});

describe('path traversal protection', () => {
  it('rejects keys that escape the memory directory', async () => {
    await expect(memoryWrite(dir, '../escape.md', 'evil')).rejects.toThrow(
      'outside memory directory',
    );
  });

  it('rejects absolute paths as keys', async () => {
    await expect(memoryRead(dir, '/etc/passwd')).rejects.toThrow(
      'outside memory directory',
    );
  });
});
