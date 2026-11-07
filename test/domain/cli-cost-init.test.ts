import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { Effect, Schema } from 'effect';
import { executeQuery, executeViewAction, type QueryRequest } from '../../src/app/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { runApplication } from '../support/repository.ts';
import { readProjectConfig, writeProjectConfig } from '../support/support.ts';
import { tmpdir } from '../support/temporary.ts';
const Ack = Schema.Struct({});
const ErrorOutput = Schema.Struct({ error: Schema.String });
const CheckOutput = Schema.Struct({ ok: Schema.Boolean });
const DoctorOutput = Schema.Struct({ missingTestRoots: Schema.Array(Schema.String) });
const DryRunOutput = Schema.Struct({ dryRun: Schema.Boolean });
// Initialization is the tested input, so this repository starts without a template.
const scratch = mkdtempSync(join(tmpdir(), 'concord-init-boundaries-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
function write(root: string, path: string, source: string) { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), source); }
async function decode<A>(pending: Promise<unknown>, schema: Schema.ConstraintDecoder<A, never>, status: number): Promise<A> {
  const result = await pending.then(value => ({ status: 0, value }), error => ({ status: 1, value: { error: error.code } }));
  assert.equal(result.status, status, JSON.stringify(result.value));
  return Schema.decodeUnknownSync(schema)(result.value);
}
async function query<A>(root: string, request: QueryRequest, schema: Schema.ConstraintDecoder<A, never>, status = 0) {
  return decode(runApplication(executeQuery(root, request)).then(reply => { assert.equal(reply.exitCode, 0); return reply.value; }), schema, status);
}
async function action<A>(root: string, input: unknown, schema: Schema.ConstraintDecoder<A, never>, status = 0) {
  return decode(runApplication(executeViewAction(root, input)), schema, status);
}
// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
test('installed init previews configuration, preserves existing docs, and never runs the configured command', () => Effect.runPromise(Effect.promise(async () => {
 const root = join(scratch, 'init-options'); mkdirSync(root); execFileSync('git', ['init', '-q', root]);
 write(root, 'docs/README.md', '# Existing documentation\n');
 write(root, 'docs/concepts.md', '# Existing concepts\n');
 write(root, 'docs/architecture.md', '# Existing architecture\n');
 assert.equal(existsSync(join(root, 'concord.config.ts')), false);
 const runner = { kind: 'command', argv: ['node', '-e', 'require("node:fs").writeFileSync("EXECUTED", "bad")'], sourceFiles: [], timeoutMs: 1200 };
 write(root, 'runner.json', JSON.stringify(runner));
 const input = { action: 'init', testRoots: ['spec'], runner };
 assert.equal((await action(root, { ...input, dryRun: true }, DryRunOutput)).dryRun, true);
 assert.equal(existsSync(join(root, 'concord.config.ts')), false);
 assert.equal(existsSync(join(root, '.git/concord')), false);
 (await action(root, input, Ack));
 const config = (await readProjectConfig(root));
 assert.deepEqual(config.testRoots, ['spec']); assert.deepEqual(config.runner, runner);
 assert.equal(readFileSync(join(root, 'docs/README.md'), 'utf8'), '# Existing documentation\n');
 assert.equal(readFileSync(join(root, 'docs/concepts.md'), 'utf8'), '# Existing concepts\n');
 assert.equal(readFileSync(join(root, 'docs/architecture.md'), 'utf8'), '# Existing architecture\n');
 const diagnosis = (await action(root, { action: 'doctor' }, DoctorOutput));
 assert.deepEqual(diagnosis.missingTestRoots, ['spec']);
 (await query(root, { name: 'check', input: {} }, CheckOutput));
 assert.equal(existsSync(join(root, 'EXECUTED')), false);
 assert.equal((await action(root, { action: 'init' }, ErrorOutput, 1)).error, 'ProjectExists');
})));


// @feature docs/feature/taste/cli.md
test('packed boundaries reject non-current formats and preserve configuration, owners, receipts, journals and locks', () => Effect.runPromise(Effect.promise(async () => {
 const root = (await createConsumer());
 writeProjectConfig(root, { testRoots: ['test', 'tests'] });
 const taste = 'docs/taste.md';
 const current = readFileSync(join(root, taste), 'utf8');
 const invalidTaste = `---\nstatus: active\n---\n${current}`;
 write(root, taste, invalidTaste);
 assert.equal((await query(root, { name: 'taste', input: {} }, ErrorOutput, 1)).error, 'TasteEntryInvalid');
 assert.equal(readFileSync(join(root, taste), 'utf8'), invalidTaste);
 write(root, taste, current);
 const configPath = 'concord.config.ts';
 const config = readFileSync(join(root, configPath), 'utf8');
 for (const [source, code] of [['export default { projectId: \"retired\" };', 'InvalidData'], ['export default { ...{} };\n', 'InvalidConfigSyntax']] as const) {
  write(root, configPath, source);
  assert.equal((await query(root, { name: 'config.show', input: {} }, ErrorOutput, 1)).error, code);
  assert.equal(readFileSync(join(root, configPath), 'utf8'), source);
 }
 write(root, configPath, config);
 for (const format of ['concord.writing/v1', 'concord.writing/v2']) {
  const source = JSON.stringify({ format, bannedTerms: [] });
  write(root, 'docs/writing.md', source);
  assert.equal((await query(root, { name: 'docs.check', input: {} }, ErrorOutput, 1)).error, 'InvalidWritingPolicy');
  assert.equal(readFileSync(join(root, 'docs/writing.md'), 'utf8'), source);
 }
 const id = 'ccev_11111111111111111111111111111111';
 const receiptPath = `.git/concord/evidence/${id}.json`;
 const receipt = JSON.stringify({ format: 'concord.command-evidence/v1', id });
 write(root, receiptPath, receipt);
 (await query(root, { name: 'config.show', input: {} }, Ack));
 assert.equal(readFileSync(join(root, receiptPath), 'utf8'), receipt);
 const journalPath = '.git/concord/journal.json', lockPath = '.git/concord/lock.json';
 const journal = JSON.stringify({ format: 'concord.journal', scope: { kind: 'documents' } });
 const lock = 'preserve invalid lock bytes';
 write(root, journalPath, journal); write(root, lockPath, lock);
 for (const command of ['check', 'recover']) {
  assert.equal((await (command === 'check' ? (await query(root, { name: 'check', input: {} }, ErrorOutput, 1)) : (await action(root, { action: 'recover' }, ErrorOutput, 1)))).error, 'InvalidData');
  assert.equal(readFileSync(join(root, journalPath), 'utf8'), journal);
  assert.equal(readFileSync(join(root, lockPath), 'utf8'), lock);
 }
})));
