/**
 * @file cmd-init.ts
 * Implementation of `bract init` — scaffold a starter bract.yml in the current directory.
 * @module @losoft/bract-cli/cmd-init
 */
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

export interface InitOptions {
  /** Path to write the config file (default: bract.yml in cwd). */
  file?: string;
  /** Overwrite if the file already exists. */
  force?: boolean;
  /** Emit JSON output. */
  json?: boolean;
}

const STARTER_TEMPLATE = `\
# bract.yml — agent fleet configuration
# Run \`bract validate\` to check this file at any time.
version: 1

agents:
  - name: assistant
    model: claude-opus-4-5
    system: |
      You are a helpful assistant. Respond concisely and clearly.
    restart: on-failure
`;

/** Scaffold a starter bract.yml in the current working directory. */
export async function cmdInit(opts: InitOptions = {}): Promise<void> {
  const filePath = resolve(opts.file ?? 'bract.yml');

  if (existsSync(filePath) && !opts.force) {
    process.stderr.write(`bract init: ${filePath} already exists (use --force to overwrite)\n`);
    process.exit(1);
    return;
  }

  await Bun.write(filePath, STARTER_TEMPLATE);

  if (opts.json) {
    process.stdout.write(JSON.stringify({ created: true, file: filePath }, null, 2) + '\n');
  } else {
    process.stdout.write(`✓ Created ${filePath}\n`);
    process.stdout.write(`  Next: edit the file, then run \`bract validate\` to check it.\n`);
  }
}
