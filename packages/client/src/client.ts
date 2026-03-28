/**
 * @file client.ts
 * BractClient — send messages to agent inboxes without a running runtime.
 *
 * Writes message files directly to the filesystem using the same format
 * as @losoft/bract-runtime. The bract supervisor does not need to be
 * running — the inbox watcher will pick up the messages whenever it starts.
 *
 * @module @losoft/bract-client/client
 */
import { join } from 'node:path';
import { send } from '@losoft/bract-runtime';
import type { Message } from '@losoft/bract-runtime';

export interface SendOptions {
  /** Message body text. */
  body: string;
  /** Sender identity. Defaults to "client". */
  from?: string;
  /** Optional metadata attached to the message. */
  metadata?: Record<string, unknown>;
}

export interface BractClientOptions {
  /**
   * Path to the bract home directory.
   * Defaults to the BRACT_HOME environment variable.
   */
  home?: string;
}

/**
 * BractClient sends messages to agent inboxes by writing files to the filesystem.
 *
 * This is a thin wrapper around the bract message format. It does not require
 * the bract supervisor to be running — messages will be delivered when the
 * agent's inbox watcher polls the directory.
 *
 * @example
 * ```ts
 * const client = new BractClient({ home: '/tmp/my-bract' })
 * await client.send('my-agent', { body: 'Hello from a trigger script!' })
 * ```
 */
export class BractClient {
  private readonly home: string;

  constructor(options: BractClientOptions = {}) {
    const home = options.home ?? process.env.BRACT_HOME;
    if (!home) {
      throw new Error(
        'BractClient: no home directory specified. Pass { home } or set the BRACT_HOME environment variable.',
      );
    }
    this.home = home;
  }

  /**
   * Send a message to an agent's inbox.
   * Returns the written Message object including its generated id and timestamp.
   */
  async send(agentName: string, options: SendOptions): Promise<Message> {
    const inboxDir = join(this.home, 'agents', agentName, 'inbox');
    return send(inboxDir, options.from ?? 'client', options.body, options.metadata ?? {});
  }
}
