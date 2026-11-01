import { installationResources } from "../../src/base/installation/index.js";
import { packageBin } from '../../scripts/package-location.js';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.js';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { before, after } from 'node:test';
import { Effect, Schema } from 'effect';
import { fullCommand } from "../../src/entry/cli/index.js";
import { installConcord, packConcord } from '../support/installed-package.js';

const environment: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1', TERM: 'dumb', NODE_OPTIONS: '', NODE_DISABLE_COMPILE_CACHE: '1' };
delete environment.FORCE_COLOR;
const scratch = mkdtempSync(join(tmpdir(), 'concord-startup-'));
let packageRoot: string, entry: string;
before(() => {
  const install = join(scratch, 'install'); mkdirSync(install); writeFileSync(join(install, 'package.json'), '{"private":true,"type":"module"}');
  installConcord(install, packConcord(scratch), [], { private: true });
  packageRoot = join(install, 'node_modules/concord-sdlc'); entry = packageBin(packageRoot);
});
after(() => rmSync(scratch, { recursive: true, force: true }));
const invoke = (args: readonly string[]) => Effect.tryPromise(() => new Promise<{ stdout: string; stderr: string; status: number }>((accept, reject) => {
  execFile(process.execPath, [entry, ...args], { cwd: scratch, env: environment, encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error && typeof error.code !== 'number') { reject(error); return; }
    accept({ stdout, stderr, status: typeof error?.code === 'number' ? error.code : 0 });
  });
}));
interface Definition { readonly name: string; readonly subcommands: readonly { readonly commands: readonly Definition[] }[] }
const helpCalls: readonly string[][] = (() => {
  const paths: string[][] = [];
  const visit = (command: Definition, path: string[]) => { paths.push([...path, '--help']); for (const group of command.subcommands) for (const child of group.commands) visit(child, [...path, child.name]); };
  visit(fullCommand as unknown as Definition, []); return [[], ['--version'], ...paths];
})();

export { assert, execFile, spawnSync, appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync, tmpdir, join, resolve, pathToFileURL, test, Effect, Schema, installationResources, packageBin, environment, scratch, packageRoot, entry, invoke, helpCalls };
