import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Schema, SchemaRepresentation } from 'effect';
import { machineSchema } from '../../src/model/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { createDocument } from '../support/operations.ts';
import { LocalRepository, runApplication } from '../support/repository.ts';
import { getWorkspaceSnapshot } from '../../src/app/index.ts';
import { runCli } from '../support/cli.ts';
import { tmpdir } from '../support/temporary.ts';

// @feature docs/feature/local-sdlc/cli.md#机器可读-schema
test('schema is available without a repository and rejects unknown configuration fields', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-schema-'));
  try {
    for (const name of ['config', 'test-adapter', 'change-preview', 'model', 'workspace-wait']) {
      const result = await runCli({ argv: ['schema', name], cwd: root, env: process.env });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), machineSchema(name));
      assert.equal(JSON.parse(result.stdout).$schema, 'https://json-schema.org/draft/2020-12/schema');
    }
    const document = machineSchema('config');
    assert.equal(Schema.decodeUnknownSync(Schema.Struct({ additionalProperties: Schema.Boolean }))(document).additionalProperties, false);
    const missing = await runCli({ argv: ['schema', 'missing', '--json'], cwd: root, env: process.env });
    assert.equal(missing.exitCode, 1);
    assert.deepEqual(JSON.parse(missing.stderr).details.available, ['config', 'test-adapter', 'change-preview', 'model', 'workspace-wait']);
    assert.equal(JSON.parse(missing.stderr).error, 'SchemaNotFound');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/feature/local-sdlc/cli.md#adapter-协议
test('dependency-free JavaScript collector exchanges conform to the advertised protocol schema', async () => {
  const root = await createConsumer();
  const scratch = mkdtempSync(join(tmpdir(), 'concord-collector-schema-'));
  const transcript = join(scratch, 'transcript.jsonl');
  const call = async (args: string[]) => {
    const result = await runCli({ argv: ['--root', root, '--server=command', '--json', ...args], cwd: root, env: process.env });
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    return JSON.parse(result.stdout);
  };
  try {
    const repo = await LocalRepository.open(root);
    try { await createDocument(repo, 'feature', { id: 'cart', title: 'Cart' }); }
    finally { repo.close(); }
    mkdirSync(join(root, 'test'), { recursive: true });
    writeFileSync(join(root, 'test/cart.ts'), '// @feature docs/feature/cart/README.md\n// @name cart\nexport const testBody = () => { throw new Error("must not execute"); };\n');
    // Explicit JavaScript consumer fixture: it imports no Concord implementation.
    writeFileSync(join(root, 'adapter.mjs'), `import { readFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
if (process.argv[2] === 'collect') process.exit(0);
const request = JSON.parse(readFileSync(0, 'utf8'));
const payload = request.op === 'collect-plan'
  ? { invocations: [{ invocationId: 'collect', argv: [process.execPath, 'adapter.mjs', 'collect'], cwd: '.', envNames: [], reports: [] }], planContext: {} }
  : { cases: [{ nativeId: 'cart:add', project: 'cart', file: 'test/cart.ts', kind: 'leaf', range: { startLine: 3, endLine: 3, sourceDigest: 'sha256:' + createHash('sha256').update(readFileSync('test/cart.ts')).digest('hex') }, tags: { layer: 'unit' }, provenance: 'cart/1' }], capabilities: { realCollection: true, leaf: true, parameterGroups: false, range: true, rangeTrivia: true, tags: true }, completeness: { complete: true, gaps: [] } };
const response = { format: request.format, op: request.op, requestId: request.requestId, planId: request.context.planId, inputs: request.context.inputs, payload };
appendFileSync(${JSON.stringify(transcript)}, JSON.stringify(request) + '\\n' + JSON.stringify(response) + '\\n');
process.stdout.write(JSON.stringify(response));
`);
    writeFileSync(join(root, 'concord.config.ts'), `export default ${JSON.stringify({ testRoots: ['test'], sourceRoots: [], testAdapters: [{ id: 'cart', include: ['test'], argv: [process.execPath, 'adapter.mjs'], implementationFiles: ['adapter.mjs'], inputRoots: [], frameworkVersion: 'cart/1', lockFiles: [], envNames: [] }] })};\n`);
    await call(['test', 'discover']);
    const listed = await call(['test', 'list']);
    const shown = await call(['test', 'show', listed.cases[0].id]);
    assert.deepEqual(shown.bindings, listed.bindings);
    assert.equal(shown.bindings[0].current, true);
    assert.equal(shown.bindings[0].nativeCases[0].nativeId, 'cart:add');
    assert.deepEqual(shown.bindings[0].nativeCases[0].tags, { layer: 'unit' });
    // Command-scoped CLI owners have released the observation store before this direct consumer opens it.
    const workspace = await runApplication(getWorkspaceSnapshot(root, 'use'));
    assert.deepEqual(workspace.bindings, listed.bindings);
    writeFileSync(join(root, 'test/cart.ts'), readFileSync(join(root, 'test/cart.ts'), 'utf8') + '// changed after collection\n');
    const stale = await call(['test', 'show', listed.cases[0].id]);
    assert.equal(stale.bindings[0].current, false);
    assert.equal(stale.bindings[0].complete, false);
    assert.deepEqual(stale.bindings[0].nativeCases, []);
    assert.ok(stale.bindings[0].gaps.includes('NativeObservationStale'));
    assert.ok(stale.observations.length > 0);
    const protocol = await call(['schema', 'test-adapter']);
    const decoder = SchemaRepresentation.fromJsonSchemaDocument({ dialect: 'draft-2020-12', schema: protocol, definitions: {} }, { patterns: 'apply' });
    const validate = Schema.toStandardSchemaV1(Schema.toType(decoder), { parseOptions: { onExcessProperty: 'error' } })['~standard'].validate;
    const messages = readFileSync(transcript, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.equal(messages.length, 4, 'Each collection operation exchanges one request and response');
    assert.deepEqual([...new Set(messages.map(message => message.op))].sort(), ['collect-parse', 'collect-plan']);
    for (const message of messages) {
      assert.equal((await validate(message)).issues, undefined, JSON.stringify(message));
      assert.ok((await validate({ ...message, extra: true })).issues);
    }
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); }
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
