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

/** Current message schema version. Increment when the shape changes. */
export const MESSAGE_VERSION = 1 as const;

export interface Message {
  /** Schema version — allows safe migration when the format changes. */
  v: typeof MESSAGE_VERSION;
  id: string;
  from: string;
  ts: string;
  body: string;
  metadata: Record<string, unknown>;
}

function messageFilename(): string {
  const ns = BigInt(Date.now()) * 1_000_000n;
  const rnd = randomBytes(8).toString('hex');
  return `${ns}-${rnd}.msg`;
}

function generateId(): string {
  return randomBytes(12).toString('hex');
}

export function send(
  inboxDir: string,
  from: string,
  body: string,
  metadata: Record<string, unknown> = {},
): Message {
  mkdirSync(inboxDir, { recursive: true });

  const msg: Message = {
    v: MESSAGE_VERSION,
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

export function reply(
  outboxDir: string,
  from: string,
  body: string,
  metadata: Record<string, unknown> = {},
): Message {
  return send(outboxDir, from, body, metadata);
}

export function listPending(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.msg'))
    .sort();
}

/**
 * Read and parse a message file.
 * - Missing `v` → normalised to v:1 (legacy compat)
 * - `v` newer than MESSAGE_VERSION → throws (upgrade bract)
 */
export function read(dir: string, filename: string): Message {
  const raw = readFileSync(join(dir, filename), 'utf8');
  const parsed = JSON.parse(raw) as Partial<Message>;
  const v = parsed.v ?? 1;

  if (v > MESSAGE_VERSION) {
    throw new Error(
      `Message ${filename} has version ${v}, runtime only supports up to ${MESSAGE_VERSION}. ` +
        'Update bract to read this message.',
    );
  }

  return { ...parsed, v: MESSAGE_VERSION } as Message;
}

export function consume(dir: string, filename: string): Message {
  const msg = read(dir, filename);
  const processedDir = join(dir, '.processed');
  mkdirSync(processedDir, { recursive: true });
  renameSync(join(dir, filename), join(processedDir, filename));
  return msg;
}
