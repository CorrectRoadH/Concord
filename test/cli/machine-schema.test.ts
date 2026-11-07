import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Schema, SchemaRepresentation } from 'effect';
import { machineSchema } from '../../src/model/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { runCli } from '../support/cli.ts';
import { tmpdir } from '../support/temporary.ts';

// @use-case docs/feature/local-sdlc/use-case/run-tests-with-own-runner.md#schema
test('schema is available without a repository and rejects unknown configuration fields', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-schema-'));
  try {
    for (const name of ['config', 'test-adapter', 'change-preview', 'model']) {
      const result = await runCli({ argv: ['schema', name], cwd: root, env: process.env });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), machineSchema(name));
      assert.equal(JSON.parse(result.stdout).$schema, 'https://json-schema.org/draft/2020-12/schema');
    }
    const document = machineSchema('config');
    assert.equal(Schema.decodeUnknownSync(Schema.Struct({ additionalProperties: Schema.Boolean }))(document).additionalProperties, false);
    const missing = await runCli({ argv: ['schema', 'missing', '--json'], cwd: root, env: process.env });
    assert.equal(missing.exitCode, 1);
    assert.deepEqual(JSON.parse(missing.stderr).details.available, ['config', 'test-adapter', 'change-preview', 'model']);
    assert.equal(JSON.parse(missing.stderr).error, 'SchemaNotFound');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/web-workbench/use-case/review-pull-request.md
test('view verify checks strict preview data and exact directory entries without a project', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'concord-preview-verify-'));
  const oid = 'a'.repeat(40);
  const value = { format: 'concord.change-preview/v1', comparison: { base: oid, head: oid, mergeBase: oid, baseLabel: 'master' }, entries: [] };
  const call = async () => runCli({ argv: ['view', 'verify', directory, '--json'], cwd: directory, env: process.env });
  try {
    mkdirSync(join(directory, 'assets'));
    for (const file of ['index.html', 'FONT-LICENSE.html']) writeFileSync(join(directory, file), 'fixture');
    writeFileSync(join(directory, 'changes.json'), JSON.stringify(value));
    const valid = await call();
    assert.equal(valid.exitCode, 0, valid.stderr);
    assert.deepEqual(JSON.parse(valid.stdout), { operation: 'view-verify', directory, comparison: value.comparison, files: 0 });
    writeFileSync(join(directory, 'changes.json'), JSON.stringify({ ...value, comparison: { ...value.comparison, extra: true } }));
    const invalid = await call();
    assert.equal(invalid.exitCode, 1);
    assert.equal(JSON.parse(invalid.stderr).error, 'PreviewDataInvalid');
    assert.equal(JSON.parse(invalid.stderr).details.path, 'comparison.extra');
    writeFileSync(join(directory, 'changes.json'), JSON.stringify(value));
    symlinkSync('../changes.json', join(directory, 'assets/link'));
    const link = await call();
    assert.equal(JSON.parse(link.stderr).error, 'PreviewDirectoryInvalid');
    assert.equal(JSON.parse(link.stderr).details.path, join(directory, 'assets/link'));
    rmSync(join(directory, 'assets/link'));
    writeFileSync(join(directory, 'extra'), 'extra');
    assert.equal(JSON.parse((await call()).stderr).error, 'PreviewDirectoryInvalid');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

// @use-case docs/feature/local-sdlc/use-case/run-tests-with-own-runner.md#verify
test('dependency-free JavaScript adapter discovers, selects and replays a fix through the CLI', async () => {
  const { LocalRepository } = await import('../support/repository.ts');
  const { createDocument } = await import('../support/operations.ts');
  const { execFileSync } = await import('node:child_process');
  const { readFileSync } = await import('node:fs');
  const root = (await createConsumer());
  const scratch = mkdtempSync(join(tmpdir(), 'concord-own-adapter-'));
  const transcript = join(scratch, 'transcript.jsonl');
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  const call = async (args: string[], status = 0) => runCli({ argv: ['--root', root, '--server', 'command', '--json', ...args], cwd: root, env: process.env }).then(result => {
    assert.equal(result.exitCode, status, result.stdout + result.stderr);
    return JSON.parse(result.stdout || result.stderr);
  });
  try {
    const repo = (await LocalRepository.open(root));
    try {
      await createDocument(repo, 'feature', { id: 'cart', title: 'Cart' });
      await createDocument(repo, 'issue', { id: 'duplicate', title: 'Duplicate SKU' });
    } finally { repo.close(); }
    mkdirSync(join(root, 'test'), { recursive: true });
    writeFileSync(join(root, 'test/cart.ts'), '// @feature docs/feature/cart/README.md\n// @issue docs/issues/duplicate.md\n// @name cart\n');
    writeFileSync(join(root, 'outcome.txt'), 'failed');
    // This is an explicit JavaScript consumer fixture with no Concord imports.
    writeFileSync(join(root, 'adapter.mjs'), `import { readFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
if (process.argv[2] === 'invoke') process.exit(process.argv[3] === 'collect' || readFileSync('outcome.txt', 'utf8') === 'passed' ? 0 : 1);
const request = JSON.parse(readFileSync(0, 'utf8'));
const caps = { realCollection: true, leaf: true, parameterGroups: false, exactSelection: true, perItemReport: true, range: true, rangeTrivia: true, tags: false, skipVisibility: true };
const outcome = readFileSync('outcome.txt', 'utf8');
const invoke = (selected) => ({ invocationId: 'invoke', argv: [process.execPath, 'adapter.mjs', 'invoke', selected ? 'run' : 'collect'], cwd: '.', envNames: [], reports: [], ...(selected ? { requested: selected } : {}) });
let payload;
if (request.op === 'collect-plan') payload = { invocations: [invoke()], planContext: {} };
else if (request.op === 'collect-parse') payload = { cases: [{ nativeId: 'cart:add', project: 'cart', file: 'test/cart.ts', kind: 'leaf', range: { startLine: 1, endLine: 4, sourceDigest: 'sha256:' + createHash('sha256').update(readFileSync('test/cart.ts')).digest('hex') }, selection: { opaqueId: 'cart:add', capabilityVersion: '1' }, tags: {}, provenance: 'cart/1' }], capabilities: caps, completeness: { complete: true, gaps: [] } };
else if (request.op === 'select-plan') payload = { invocations: [invoke(request.payload.nativeIds)], planContext: {} };
else payload = { observed: outcome === 'prepare-failed' ? [] : request.payload.requested.map(nativeId => ({ nativeId, outcome, provenance: 'cart/1' })), capabilities: caps, completeness: { complete: true, gaps: [] } };
const response = { format: request.format, op: request.op, requestId: request.requestId, planId: request.context.planId, inputs: request.context.inputs, payload };
appendFileSync(${JSON.stringify(transcript)}, JSON.stringify(request) + '\\n' + JSON.stringify(response) + '\\n');
process.stdout.write(JSON.stringify(response));
`);
    writeFileSync(join(root, 'concord.config.ts'), `export default ${JSON.stringify({ testRoots: ['test'], sourceRoots: [], testAdapters: [{ id: 'cart', include: ['test'], argv: [process.execPath, 'adapter.mjs'], implementationFiles: ['adapter.mjs'], inputRoots: [], frameworkVersion: 'cart/1', lockFiles: [], envNames: [], runTimeoutMs: 700_000, wallTimeoutMs: 800_000 }] })};\n`);
    git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
    git('add', '.'); git('commit', '-qm', 'Failing regression');
    const defect = git('rev-parse', 'HEAD');
    await call(['test', 'discover']);
    const listed = await call(['test', 'list']);
    assert.equal(listed.cases.length, 1);
    const id = listed.cases[0].id;
    assert.match(id, /^neref_/u);
    const red = await call(['test', 'run', id, '--require-native'], 1);
    assert.equal(red.scope, 'native'); assert.equal(red.commandOutcome, 'red');
    writeFileSync(join(root, 'outcome.txt'), 'passed');
    git('add', 'outcome.txt'); git('commit', '-qm', 'Fix duplicate SKU');
    const fix = git('rev-parse', 'HEAD');
    const green = await call(['test', 'run', id, '--require-native']);
    assert.equal(green.commandOutcome, 'green'); assert.deepEqual(green.requested, ['cart:add']);
    const replay = await call(['test', 'verify', id, '--defect', defect, '--fix', fix]);
    assert.equal(replay.red[0].scope, 'native'); assert.equal(replay.red[0].commandOutcome, 'red');
    assert.equal(replay.green[0].commandOutcome, 'green');
    writeFileSync(join(root, 'outcome.txt'), 'prepare-failed');
    const invalid = await call(['test', 'run', id, '--require-native'], 1);
    assert.equal(invalid.commandOutcome, 'invalid');
    git('add', 'outcome.txt'); git('commit', '-qm', 'Preparation cannot run');
    const unverifiable = await call(['test', 'verify', id, '--defect', defect, '--fix', git('rev-parse', 'HEAD')], 1);
    assert.equal(unverifiable.error, 'FixUnverifiable');
    writeFileSync(join(root, 'outcome.txt'), 'passed');
    git('add', 'outcome.txt'); git('commit', '-qm', 'Prepared fix');
    const closed = await call(['issue', 'close', 'duplicate', '--fixed', '--defect', defect]);
    assert.equal(closed.red[0].scope, 'native'); assert.equal(closed.green[0].commandOutcome, 'green');
    const protocol = await call(['schema', 'test-adapter']);
    const decoder = SchemaRepresentation.fromJsonSchemaDocument({ dialect: 'draft-2020-12', schema: protocol, definitions: {} }, { patterns: 'apply' });
    const validate = Schema.toStandardSchemaV1(Schema.toType(decoder), { parseOptions: { onExcessProperty: 'error' } })["~standard"].validate;
    const messages = readFileSync(transcript, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual([...new Set(messages.map(message => message.op))].sort(), ['collect-parse', 'collect-plan', 'report-parse', 'select-plan']);
    for (const message of messages) {
      assert.equal((await validate(message)).issues, undefined, JSON.stringify(message));
      assert.ok((await validate({ ...message, extra: true })).issues);
    }
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); }
});

// @use-case docs/feature/local-sdlc/use-case/run-tests-with-own-runner.md
test('external adapter timeouts accept longer E2E and retain builtin ceilings', async () => {
  const { parseTypeScriptConfig } = await import('../../src/base/workspace/index.ts');
  const adapter = { id: 'external', include: ['test'], argv: ['runner'], implementationFiles: ['runner'], inputRoots: [], frameworkVersion: '1', lockFiles: [], envNames: [] };
  const config = (value: object) => `export default ${JSON.stringify({ testRoots: ['test'], testAdapters: [value] })};`;
  assert.equal((await parseTypeScriptConfig(config({ ...adapter, collectTimeoutMs: 600000, runTimeoutMs: 7200000, wallTimeoutMs: 7200000 }))).testAdapters![0]!.runTimeoutMs, 7200000);
  for (const value of [{ collectTimeoutMs: 600001 }, { runTimeoutMs: 7200001 }, { wallTimeoutMs: 7200001 }]) (await assert.rejects(async () => (await parseTypeScriptConfig(config({ ...adapter, ...value })))));
  const { argv: _argv, ...builtin } = adapter;
  for (const value of [{ collectTimeoutMs: 60001 }, { runTimeoutMs: 300001 }, { wallTimeoutMs: 600001 }]) (await assert.rejects(async () => (await parseTypeScriptConfig(config({ ...builtin, builtin: 'node-test', ...value })))));
});
