/**
 * @file send-message.ts
 * Convenience function for one-shot message sending without managing a client instance.
 *
 * @module @losoft/bract-client/send-message
 */
import { BractClient } from './client.js';
import type { SendOptions } from './client.js';

export interface SendMessageOptions extends SendOptions {
  /**
   * Path to the bract home directory.
   * Defaults to the BRACT_HOME environment variable.
   */
  home?: string;
}

/**
 * Send a single message to an agent's inbox.
 * Creates a one-shot BractClient internally.
 *
 * @example
 * ```ts
 * import { sendMessage } from 'bract/client'
 * await sendMessage('my-agent', { body: 'Hello!' })
 * ```
 */
export async function sendMessage(
  agentName: string,
  options: SendMessageOptions,
): Promise<void> {
  const { home, ...sendOpts } = options;
  const client = new BractClient({ home });
  await client.send(agentName, sendOpts);
}
