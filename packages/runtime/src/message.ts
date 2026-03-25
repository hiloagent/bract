import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  renameSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export interface Message {
  id: string;
  from: string;
  ts: string;
  body: string;
  metadata: Record<string, unknown>;
}

/** Generate a sortable message filename: {timestamp_ns}-{random_hex}.msg */
function messageFilename(): string {
  const ns = BigInt(Date.now()) * 1_000_000n;
  const rnd = randomBytes(8).toString('hex');
  return `${ns}-${rnd}.msg`;
}

/** Generate a simple unique ID for a message. */
function generateId(): string {
  return randomBytes(12).toString('hex');
}

/** Write a message into an agent's inbox. Returns the written Message. */
export function send(
  inboxDir: string,
  from: string,
  body: string,
  metadata: Record<string, unknown> = {},
): Message {
  mkdirSync(inboxDir, { recursive: true });

  const msg: Message = {
    id: generateId(),
    from,
    ts: new Date().toISOString(),
    body,
    metadata,
  };

  const filename = messageFilename();
  writeFileSync(join(inboxDir, filename), JSON.stringify(msg, null, 2) + '\n', 'utf8');
  return msg;
}

/** Write a message into an agent's outbox. Returns the written Message. */
export function reply(
  outboxDir: string,
  from: string,
  body: string,
  metadata: Record<string, unknown> = {},
): Message {
  return send(outboxDir, from, body, metadata);
}

/** List all pending message filenames in a directory, sorted oldest-first. */
export function listPending(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.msg'))
    .sort();
}

/** Read a message from a file without consuming it. */
export function read(dir: string, filename: string): Message {
  const raw = readFileSync(join(dir, filename), 'utf8');
  return JSON.parse(raw) as Message;
}

/**
 * Consume a message: read it, then move it to `dir/.processed/` so it is
 * preserved for debugging but will not be re-delivered.
 */
export function consume(dir: string, filename: string): Message {
  const msg = read(dir, filename);
  const processedDir = join(dir, '.processed');
  mkdirSync(processedDir, { recursive: true });
  renameSync(join(dir, filename), join(processedDir, filename));
  return msg;
}
