import { sourceCli } from '../support/source-consumer.ts';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { stopWorkspaceServer } from '../support/stop-workspace-server.ts';
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
after(() => Effect.runPromise(Effect.sync(() => {
  try { for (const root of consumers) stopWorkspaceServer(root, cli); }
  finally { rmSync(scratch, { recursive: true, force: true }); }
})));
function run(root: string, args: readonly string[], input = '', status = 0): any {
  const result = spawnSync(process.execPath, [cli, '--root', root, '--json', '--fresh', ...args], { input, encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, status, JSON.stringify({ args, stdout: result.stdout, stderr: result.stderr }));
  return JSON.parse(result.stdout || result.stderr);
}
function consumer(name: string): string {
  const root = join(scratch, name); mkdirSync(root); execFileSync('git', ['init', '-q', root]); consumers.push(root); return root;
}
const action = (root: string, input: unknown, status = 0): any => run(root, ['action', '--input', '-'], JSON.stringify(input), status);
export { sourceCli, assert, execFileSync, spawnSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, tmpdir, stopWorkspaceServer, join, test, before, after, Effect, Schema, InitializationReceiptSchema, scratch, consumers, cli, run, consumer, action };
