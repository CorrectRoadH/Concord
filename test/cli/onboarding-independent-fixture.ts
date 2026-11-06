import { sourceCli } from '../support/source-consumer.ts';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { runCli } from '../support/cli.ts';
import { genericPrivateDirectorySync } from '../../src/base/publication/index.ts';
import { join } from 'node:path';
import test, { before, after } from 'node:test';
import { Effect, Schema } from 'effect';
import { InitializationReceiptSchema } from '../../src/model/index.ts';

const scratch = mkdtempSync(join(tmpdir(), 'concord-public-onboarding-'));
const consumers: string[] = [];
let cli: string;
before(() => Effect.runPromise(Effect.sync(() => {

  cli = sourceCli();
})));
after(async () => {
  try { for (const root of consumers) await stopWorkspaceServer(root); }
  finally { rmSync(scratch, { recursive: true, force: true }); }
});
async function stopWorkspaceServer(root: string): Promise<void> {
  if (!existsSync(root)) return;
  const record = join(genericPrivateDirectorySync(root, process.env), 'server/current.json');
  if (!existsSync(record)) return;
  const instance = readFileSync(record, 'utf8').trim();
  const stopped = await runCli({ argv: ['--root', root, '--json', 'server', 'stop'], cwd: process.cwd(), env: process.env });
  const processes = stopped.exitCode === 0 ? '' : spawnSync('ps', ['-axo', 'pid=,ppid=,stat=,command='], { encoding: 'utf8' }).stdout.split('\n').filter(line => line.includes(root)).join('\n');
  assert.equal(stopped.exitCode, 0, `Fixture service cleanup failed for ${root}: ${stopped.stdout}${stopped.stderr}\nTarget: ${instance}\nRemaining record: ${existsSync(record)}\nProcesses: ${processes}`);
  assert.equal(existsSync(record), false, 'server stop confirms instance cleanup');
}
async function run(root: string, args: readonly string[], input = '', status = 0): Promise<any> {
  const result = await runCli({ argv: ['--root', root, '--json', '--fresh', ...args], cwd: process.cwd(), env: process.env, stdin: input });
  assert.equal(result.exitCode, status, JSON.stringify({ args, stdout: result.stdout, stderr: result.stderr }));
  return JSON.parse(result.stdout || result.stderr);
}
function consumer(name: string): string {
  const root = join(scratch, name); mkdirSync(root); execFileSync('git', ['init', '-q', root]); consumers.push(root); return root;
}
const action = (root: string, input: unknown, status = 0): Promise<any> => run(root, ['action', '--input', '-'], JSON.stringify(input), status);
export { sourceCli, assert, execFileSync, spawnSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, tmpdir, stopWorkspaceServer, join, test, before, after, Effect, Schema, InitializationReceiptSchema, scratch, consumers, cli, run, consumer, action };
