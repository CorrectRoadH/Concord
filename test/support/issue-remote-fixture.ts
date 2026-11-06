import { initialize } from './operations.ts';
import { writeGhFixture } from './gh-fixture.ts';
import { packageBin } from './installed-package.ts';
import { sourceConcord, prepareSourceConsumer } from './installed-package.ts';
// @concord-file
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from './temporary.ts';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { makeOwnedProcessService } from "../../src/base/process/index.ts";
import { LocalRepository } from "./repository.ts";

import { setConfig, showConfig } from "../../src/app/index.ts";

export interface Call { readonly args: readonly string[]; readonly stdin: string; readonly env: Readonly<Record<string, unknown>> }
const ReceiptSchema = Schema.Struct({
  operation: Schema.Literal('issue-plan'), receiptId: Schema.String, connection: Schema.String,
  issueOperation: Schema.String, target: Schema.String, payloadDigest: Schema.String,
  remotePreimageDigest: Schema.String, expiresAt: Schema.String, authorize: Schema.String,
});
export type Receipt = typeof ReceiptSchema.Type;
export const connection = { id: 'product-gh', provider: 'github', transport: 'gh', owner: 'example', repo: 'product', repositoryId: '42' } as const;
export const issue = (number = 12, extra: Readonly<Record<string, unknown>> = {}) => ({ number, html_url: `https://github.com/example/product/issues/${number}`, title: 'Planned title', body: 'initial', state: 'open', labels: [{ name: 'old' }], ...extra });
export const scratch = mkdtempSync(join(tmpdir(), 'concord-issue-remote-'));
export const bin = join(scratch, 'bin');
export const scenarioFile = join(scratch, 'scenario.json');
export const callsFile = join(scratch, 'calls.ndjson');
writeGhFixture(bin, scenarioFile, callsFile);
export let packedCli: string;
test.before(() => Effect.runPromise(Effect.sync(() => {
  const packed = sourceConcord();
  const tool = join(scratch, 'tool'); mkdirSync(tool); writeFileSync(join(tool, 'package.json'), '{"private":true}');
  prepareSourceConsumer(tool, packed);
  packedCli = packageBin(join(tool, 'node_modules/concord-sdlc'));
})));
test.after(() => { rmSync(scratch, { recursive: true, force: true }); });
export function consumer(name: string, selected: unknown = connection): string {
  const root = join(scratch, name); mkdirSync(root); execFileSync('git', ['init', '-q', root]);
  const initial = new LocalRepository(root, { initialize: true }); try { initialize(initial); } finally { initial.close(); }
  const repository = new LocalRepository(root);
  try { const config = showConfig(repository); setConfig(repository, { ...config.config, feedbackConnections: Schema.decodeUnknownSync(Schema.Array(Schema.Unknown))([selected]) as typeof config.config.feedbackConnections }, config.digest); }
  finally { repository.close(); }
  return root;
}
export function mode(extra: Readonly<Record<string, unknown>> = {}) { writeFileSync(scenarioFile, JSON.stringify({ issue: issue(), list: [], ...extra })); writeFileSync(callsFile, ''); }
export function calls(): readonly Call[] { return readFileSync(callsFile, 'utf8').trim().split('\n').filter(Boolean).map(source => JSON.parse(source) as Call); }
export function writes(): readonly Call[] { return calls().filter(call => call.args.includes('--method') && call.args[call.args.indexOf('--method') + 1] !== 'GET'); }
export function cli(root: string, args: readonly string[], timeout = 150_000) {
  return spawnSync(process.execPath, [packedCli, '--root', root, 'issue', 'remote', ...args, '--json'], { cwd: root, encoding: 'utf8', timeout, env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}`, GH_DEBUG: 'api', GH_REPO: 'attacker/other' } });
}
export function plan(root: string, operation: string, args: readonly string[] = ['12']): Receipt {
  const result = cli(root, ['preview', operation, ...args, '--connection', connection.id]);
  assert.equal(result.status, 0, result.stderr);
  const receipt = Schema.decodeUnknownSync(Schema.fromJsonString(ReceiptSchema), { onExcessProperty: 'error' })(result.stdout);
  assert.equal(receipt.connection, connection.id);
  assert.equal(receipt.issueOperation, operation);
  assert.match(receipt.payloadDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.match(receipt.remotePreimageDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.match(receipt.expiresAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)$/u);
  assert.ok(Number.isFinite(Date.parse(receipt.expiresAt)));
  assert.equal(writes().length, 0);
  assert.match(receipt.authorize, new RegExp(`^${operation}:example/product(?:#12)?@[a-f0-9]{12}$`));
  assert.equal(receipt.authorize.split('@')[1], receipt.payloadDigest.slice(7, 19));
  assert.equal(statSync(join(root, '.git/concord/issue-plan/v1/planned', `${receipt.receiptId}.json`)).mode & 0o777, 0o600);
  return receipt;
}
export function execute(root: string, receipt: Receipt, authorization = receipt.authorize, selected: string = connection.id) {
  const result = cli(root, ['apply', receipt.receiptId, '--connection', selected, '--authorize', authorization]);
  if (result.status === 0) {
    const output = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({
      operation: Schema.Literal('issue-execute'), receiptId: Schema.String, issueOperation: Schema.String,
      issue: Schema.Struct({ number: Schema.Int, url: Schema.String, state: Schema.String, title: Schema.String, labels: Schema.Array(Schema.String) }),
    })), { onExcessProperty: 'error' })(result.stdout);
    assert.equal(output.receiptId, receipt.receiptId);
    assert.equal(output.issueOperation, receipt.issueOperation);
  }
  return result;
}
export function error(result: ReturnType<typeof cli>, code: string | readonly string[]) { assert.equal(result.status, 1, result.stdout); const actual = (JSON.parse(result.stderr) as { error: string }).error; if (typeof code === 'string') assert.equal(actual, code, result.stderr); else assert.ok(code.includes(actual), result.stderr); }
export function alterReceipt(root: string, receipt: Receipt, patch: Readonly<Record<string, unknown>>) {
  const path = join(root, '.git/concord/issue-plan/v1/planned', `${receipt.receiptId}.json`);
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')) as object, ...patch }));
}

export { packageBin };
export { sourceConcord };
export { prepareSourceConsumer };
export { assert };
export { execFileSync };
export { spawnSync };
export { existsSync };
export { mkdirSync };
export { mkdtempSync };
export { readFileSync };
export { rmSync };
export { writeFileSync };
export { statSync };
export { tmpdir };
export { join };
export { resolve };
export { test };
export { Effect };
export { Schema };
export { makeOwnedProcessService };
export { LocalRepository };
export { initialize };
export { setConfig };
export { showConfig };
