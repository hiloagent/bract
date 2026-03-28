#!/usr/bin/env bun
/**
 * @file index.ts
 * bract CLI entry point. Parses argv and dispatches to subcommands.
 * Commands: ps | send | inbox | read | spawn | validate | up | down | log
 * Flags: --home <path> | --json | --quiet
 * @module @losoft/bract-cli
 */
/**
 * bract CLI — entry point.
 *
 * Parsing strategy: no third-party parser. We walk argv manually so the
 * binary stays dependency-free beyond @losoft/bract-runtime.
 *
 * Global flags (before the sub-command):
 *   --home <path>   Override BRACT_HOME
 *   --json          Machine-readable output
 *   --quiet         Suppress non-essential output
 *
 * Commands implemented here:
 *   ps                        List all agents
 *   send <name> <message>     Write a message to an agent's inbox
 *   inbox <name>              Show pending inbox messages
 *   read <name>               Show latest outbox message(s)
 *   spawn <name>              Spawn agent from bract.yml
 *   validate [--file <path>]  Validate bract.yml against schema
 *   up [--follow]             Start the supervisor and all agents
 *   down                      Stop the supervisor and all agents
 *   log <name> [-f] [--all]   Show or stream agent logs
 */

import { cmdPs } from './cmd-ps.js';
import { cmdSend } from './cmd-send.js';
import { cmdInbox } from './cmd-inbox.js';
import { cmdRead } from './cmd-read.js';
import { cmdSpawn } from './cmd-spawn.js';
import { cmdValidate } from './cmd-validate.js';
import { cmdUp } from './cmd-up.js';
import { cmdDown } from './cmd-down.js';
import { cmdLog } from './cmd-log.js';

interface GlobalFlags {
  home?: string;
  json: boolean;
  quiet: boolean;
}

function parseGlobalFlags(argv: string[]): { flags: GlobalFlags; rest: string[] } {
  const flags: GlobalFlags = { json: false, quiet: false };
  const rest: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--home' && argv[i + 1]) {
      flags.home = argv[++i];
    } else if (arg === '--json') {
      flags.json = true;
    } else if (arg === '--quiet') {
      flags.quiet = true;
    } else {
      rest.push(...argv.slice(i));
      break;
    }
    i++;
  }
  return { flags, rest };
}

function extractFlag(args: string[], flag: string): { found: boolean; rest: string[] } {
  const idx = args.indexOf(flag);
  if (idx === -1) return { found: false, rest: args };
  const rest = [...args.slice(0, idx), ...args.slice(idx + 1)];
  return { found: true, rest };
}

function extractValueFlag(
  args: string[],
  flag: string,
): { value: string | undefined; rest: string[] } {
  const idx = args.indexOf(flag);
  if (idx === -1 || args[idx + 1] === undefined) return { value: undefined, rest: args };
  const rest = [...args.slice(0, idx), ...args.slice(idx + 2)];
  return { value: args[idx + 1], rest };
}

function usage(): void {
  process.stdout.write(
    [
      'Usage: bract [--home <path>] [--json] <command> [args]',
      '',
      'Fleet:',
      '  up [--follow]               Start supervisor and all agents from bract.yml',
      '  down                        Stop supervisor and all agents',
      '  ps                          List all agents',
      '',
      'Agent:',
      '  spawn <name>                Spawn a single agent from bract.yml',
      '  spawn --all                 Spawn all agents (use up for supervisor)',
      '  log <name> [-f] [--all]     Show or stream agent logs',
      '',
      'Messaging:',
      '  send <name> <message>       Send a message to an agent',
      '  send <name> -               Read message body from stdin',
      '  inbox <name> [--all]        Show inbox messages',
      '  read <name> [--all]         Show outbox messages',
      '',
      'Config:',
      '  validate [--file <path>]    Validate bract.yml against schema',
      '',
      'Flags:',
      '  --home <path>   Override BRACT_HOME (default: ~/.bract)',
      '  --json          Machine-readable JSON output',
      '  --quiet         Suppress non-essential output',
    ].join('\n') + '\n',
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  // Check for hidden worker sentinel (used by spawnDetached in compiled binary).
  // When the compiled binary spawns itself as an agent worker, it passes __worker
  // as the first argument, which triggers this special path.
  if (argv[0] === '__worker') {
    const { runWorker } = await import('./agent-worker.js');
    await runWorker();
    return;
  }

  if (argv[0] === '__supervisor') {
    const { runSupervisor } = await import('./supervisor-worker.js');
    await runSupervisor();
    return;
  }

  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    usage();
    return;
  }

  const { flags, rest } = parseGlobalFlags(argv);
  const [command, ...cmdArgs] = rest;

  // Also scan cmdArgs for global flags placed after the subcommand.
  // e.g. `bract validate --file foo.yml --json` — parseGlobalFlags stops at
  // the first non-flag token (the subcommand), so --json ends up in cmdArgs.
  const { found: jsonInArgs, rest: cmdArgsClean } = extractFlag(cmdArgs, '--json');
  const { found: quietInArgs, rest: cmdArgsParsed } = extractFlag(cmdArgsClean, '--quiet');
  const json = flags.json || jsonInArgs;
  const quiet = flags.quiet || quietInArgs;

  switch (command) {
    case 'ps': {
      cmdPs({ home: flags.home, json });
      break;
    }

    case 'send': {
      const [name, ...bodyParts] = cmdArgsParsed;
      if (!name) {
        process.stderr.write('bract send: agent name required\n');
        process.exit(2);
      }
      const { value: from, rest: argsAfterFrom } = extractValueFlag(bodyParts, '--from');
      const rawBody = argsAfterFrom.join(' ');

      let body: string;
      if (rawBody === '-' || rawBody === '') {
        body = await readStdin();
        if (!body) {
          process.stderr.write('bract send: message body required (got empty stdin)\n');
          process.exit(2);
        }
      } else {
        body = rawBody;
      }

      cmdSend(name, body, { home: flags.home, from });
      break;
    }

    case 'inbox': {
      const [name, ...inboxArgs] = cmdArgsParsed;
      if (!name) {
        process.stderr.write('bract inbox: agent name required\n');
        process.exit(2);
      }
      const { found: all } = extractFlag(inboxArgs, '--all');
      cmdInbox(name, { home: flags.home, all, json });
      break;
    }

    case 'read': {
      const [name, ...readArgs] = cmdArgsParsed;
      if (!name) {
        process.stderr.write('bract read: agent name required\n');
        process.exit(2);
      }
      const { found: all } = extractFlag(readArgs, '--all');
      cmdRead(name, { home: flags.home, all, json });
      break;
    }

    case 'spawn': {
      const [spawnName, ...spawnRest] = cmdArgsParsed;
      const { found: all } = extractFlag(spawnRest, '--all');
      const { found: detach } = extractFlag(spawnRest, '--detach');
      const { found: follow } = extractFlag(spawnRest, '--follow');
      const { value: file } = extractValueFlag(spawnRest, '--file');
      await cmdSpawn({
        name: !all ? spawnName : undefined,
        all,
        detach,
        follow,
        file,
        home: flags.home,
        json,
      });
      break;
    }

    case 'validate': {
      const { value: file } = extractValueFlag(cmdArgsParsed, '--file');
      await cmdValidate({ file, json });
      break;
    }

    case 'up': {
      const { found: follow } = extractFlag(cmdArgsParsed, '--follow');
      const { value: file } = extractValueFlag(cmdArgsParsed, '--file');
      await cmdUp({ follow, file, home: flags.home, json });
      break;
    }

    case 'down': {
      await cmdDown({ home: flags.home, json });
      break;
    }

    case 'log': {
      const [name, ...logArgs] = cmdArgsParsed;
      if (!name) {
        process.stderr.write('bract log: agent name required\n');
        process.exit(2);
      }
      const { found: follow } = extractFlag(logArgs, '-f');
      const { found: followLong } = extractFlag(logArgs, '--follow');
      const { found: all } = extractFlag(logArgs, '--all');
      await cmdLog({ name, follow: follow || followLong, all, home: flags.home });
      break;
    }

    default: {
      process.stderr.write(`bract: unknown command "${command}"\n`);
      usage();
      process.exit(2);
    }
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (d: Buffer) => chunks.push(d));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8').trim()));
    process.stdin.on('error', reject);
  });
}

main().catch((err) => {
  process.stderr.write(`bract: ${(err as Error).message}\n`);
  process.exit(1);
});
