#!/usr/bin/env node
/**
 * bract CLI shim — resolves the correct platform binary from the
 * optionally-installed @losoft/bract-cli-<platform> package and execs it.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const PLATFORM_PACKAGES = {
  'linux-x64':    '@losoft/bract-cli-linux-x64',
  'linux-arm64':  '@losoft/bract-cli-linux-arm64',
  'darwin-x64':   '@losoft/bract-cli-darwin-x64',
  'darwin-arm64': '@losoft/bract-cli-darwin-arm64',
  'win32-x64':    '@losoft/bract-cli-windows-x64',
};

const key = `${process.platform}-${process.arch}`;
const platformPkg = PLATFORM_PACKAGES[key];

if (!platformPkg) {
  process.stderr.write(
    `bract: unsupported platform: ${key}\n` +
    `Supported platforms: ${Object.keys(PLATFORM_PACKAGES).join(', ')}\n`,
  );
  process.exit(1);
}

const require = createRequire(import.meta.url);
let pkgDir;
try {
  pkgDir = require.resolve(`${platformPkg}/package.json`).replace(/[/\\]package\.json$/, '');
} catch {
  process.stderr.write(
    `bract: platform package ${platformPkg} is not installed.\n` +
    `This is likely a bug — please file an issue at https://github.com/hiloagent/bract/issues\n`,
  );
  process.exit(1);
}

const binary = join(pkgDir, process.platform === 'win32' ? 'bract.exe' : 'bract');
const result = spawnSync(binary, process.argv.slice(2), { stdio: 'inherit' });
process.exit(result.status ?? 1);
