import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { readEvidence, runCase, verifyFixedEvidence } from '../dist/evidence.js';
import { OwnedProcessLive, runOwnedProcess } from '../dist/owned-process.js';
import { loadDocuments } from '../dist/documents.js';
import { LocalRepository, initialize } from '../dist/storage.js';
import { AnnotatedCaseSchema, ConcordError, ProjectSchema, canonical, objectDigest, type AnnotatedCase } from '../dist/shared.js';
import { readProjectConfig, writeProjectConfig } from './support.js';
import { deriveTestReference } from '../dist/test-reference.js';

function write(root: string, path: string, source: string) { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), source); }
const consumer = Effect.acquireRelease(
  Effect.sync(() => {
    const root = mkdtempSync(join(tmpdir(), 'concord-evidence-'));
    execFileSync('git', ['init', '-q', root]);
    const repo = new LocalRepository(root, { initialize: true });
    try { initialize(repo); } finally { repo.close(); }
    return root;
  }),
  (root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
);
const repository = (root: string) => Effect.acquireRelease(
  Effect.sync(() => new LocalRepository(root)),
  (repo) => Effect.sync(() => repo.close()),
);
const withRepository = <A, E>(root: string, use: (repo: LocalRepository) => Effect.Effect<A, E, never>) =>
  Effect.scoped(repository(root).pipe(Effect.flatMap(use)));
const feature = `---\nformat: concord.document/v1\nid: example\ntitle: Example\ncreatedAt: 2026-01-01T00:00:00.000Z\nkind: feature\n---\n\nFeature\n`;
const problem = `---\nformat: concord.document/v1\nid: example-problem\ntitle: Problem\ncreatedAt: 2026-01-01T00:00:00.000Z\nkind: memory\nmemoryKind: problem\nstate: open\nepoch: 0\npromotions: []\nhistory: []\n---\n\nProblem\n`;
const selected: AnnotatedCase = Schema.decodeUnknownSync(AnnotatedCaseSchema)({ id: deriveTestReference('test/example.test.mjs', 'test/example.test.mjs', 'case'), file: 'test/example.test.mjs', line: 5, name: 'case', contract: 'docs/feature/example/README.md', contractKind: 'feature', regressions: ['memory/example-problem.md'], status: 'active', framework: 'node:test', skipped: false });
function setup(root: string, source = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { value } from '../fixture.mjs';\n// @feature docs/feature/example/README.md\n// @regression memory/example-problem.md\ntest('case', () => assert.equal(value, true));\n") { write(root, 'docs/feature/example/README.md', feature); write(root, 'memory/example-problem.md', problem); write(root, 'fixture.mjs', 'export const value = false;\n'); write(root, selected.file, source); }
const issue = (repo: LocalRepository, item: AnnotatedCase = selected) =>
  runCase(repo, item, loadDocuments(repo)).pipe(Effect.provide(OwnedProcessLive));

// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md
test('binds real red-to-green receipts and current fixed proof', () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const root = yield* consumer;
  yield* Effect.sync(() => setup(root));
  const repo = yield* repository(root);
  const red = yield* issue(repo);
  yield* Effect.sync(() => {
    assert.equal(red.commandOutcome, 'fail', JSON.stringify(red));
    assert.equal(red.execution, 'nonzero');
    write(root, 'fixture.mjs', 'export const value = true;\n');
  });
  const green = yield* issue(repo);
  yield* Effect.sync(() => {
    assert.equal(green.commandOutcome, 'pass', JSON.stringify(green));
    assert.equal(green.execution, 'nonzero');
    assert.equal(readEvidence(repo, green.id).implementationDigest, green.implementationDigest);
    const docs = loadDocuments(repo);
    const problemDocument = docs.find((document) => document.path === 'memory/example-problem.md');
    assert.ok(problemDocument);
    assert.deepEqual(verifyFixedEvidence(repo, docs, [selected], problemDocument, red.id, green.id), { red: red.id, green: green.id, selectedCaseId: selected.id, epoch: 0 });
  });
}))));

// @use-case docs/feature/project-onboarding/use-case/maintain-project-config.md
test('rejects pre-binding receipts without converting them into current proof', () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const root = yield* consumer;
  yield* Effect.sync(() => setup(root));
  const repo = yield* repository(root);
  const red = yield* issue(repo);
  yield* Effect.sync(() => write(root, 'fixture.mjs', 'export const value = true;\n'));
  const green = yield* issue(repo);
  yield* Effect.sync(() => {
    const legacy = (sourceId: string, id: string): void => {
      const path = join(repo.privateDir, 'evidence', `${sourceId}.json`);
      const value = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
      delete value.configPath; delete value.configDigest; delete value.integrity;
      const unsigned = { ...value, id };
      writeFileSync(join(repo.privateDir, 'evidence', `${id}.json`), `${canonical({ ...unsigned, integrity: objectDigest(unsigned) })}\n`);
    };
    const legacyRed = 'ccev_11111111111111111111111111111111';
    const legacyGreen = 'ccev_22222222222222222222222222222222';
    legacy(red.id, legacyRed); legacy(green.id, legacyGreen);
    assert.throws(() => readEvidence(repo, legacyGreen), { code: 'EvidenceMigrationRequired' });
    const documents = loadDocuments(repo);
    const owner = documents.find((document) => document.path === 'memory/example-problem.md');
    assert.ok(owner);
    assert.throws(() => verifyFixedEvidence(repo, documents, [selected], owner, legacyRed, legacyGreen), (cause) => cause instanceof ConcordError && cause.code === 'EvidenceMigrationRequired');
  });
}))));

// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md
test('rejects all-skipped Node TAP execution', () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const root = yield* consumer;
  yield* Effect.sync(() => setup(root, "import { test } from 'node:test';\n// @feature docs/feature/example/README.md\n// @regression memory/example-problem.md\ntest.skip('case', () => {});\n"));
  const repo = yield* repository(root);
  const receipt = yield* issue(repo);
  yield* Effect.sync(() => {
    assert.equal(receipt.execution, 'skipped');
    assert.equal(receipt.commandOutcome, 'invalid');
  });
}))));

// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md
test('preserves generic unknown and invalidates owner/candidate drift during commands', () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const root = yield* consumer;
  const config = yield* Effect.sync(() => {
    setup(root);
    const decoded = readProjectConfig(root);
    const commandConfig = { ...decoded, runner: { kind: 'command' as const, argv: ['node', '-e', 'process.exit(0)'], sourceFiles: [], timeoutMs: 2000 } };
    writeProjectConfig(root, commandConfig);
    return commandConfig;
  });
  const receipt = yield* withRepository(root, (repo) => issue(repo, { ...selected, framework: 'vitest' }));
  yield* Effect.sync(() => {
    assert.equal(receipt.commandOutcome, 'pass');
    assert.equal(receipt.execution, 'unknown');
    config.runner.argv = ['node', '-e', "require('node:fs').appendFileSync('docs/feature/example/README.md','changed')"];
    writeProjectConfig(root, config);
  });
  const ownerDrift = yield* withRepository(root, (repo) => issue(repo, { ...selected, framework: 'vitest' }));
  yield* Effect.sync(() => {
    assert.equal(ownerDrift.commandOutcome, 'invalid');
    write(root, 'docs/feature/example/README.md', feature);
    config.runner.argv = ['node', '-e', "require('node:fs').appendFileSync('fixture.mjs','changed')"];
    writeProjectConfig(root, config);
  });
  const candidateDrift = yield* withRepository(root, (repo) => issue(repo, { ...selected, framework: 'vitest' }));
  yield* Effect.sync(() => assert.equal(candidateDrift.commandOutcome, 'invalid'));
}))));

// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md
test('cleans timed-out process groups and bounds output', () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const root = yield* consumer;
  const timeout = yield* runOwnedProcess(['node', '-e', 'setInterval(() => {}, 1000)'], { cwd: root, timeoutMs: 50 }).pipe(Effect.provide(OwnedProcessLive));
  yield* Effect.sync(() => {
    assert.equal(timeout.timedOut, true);
    assert.equal(timeout.groupCleanup.gone, true);
  });
  const capped = yield* runOwnedProcess(['node', '-e', "process.stdout.write('x'.repeat(5 * 1024 * 1024))"], { cwd: root }).pipe(Effect.provide(OwnedProcessLive));
  yield* Effect.sync(() => {
    assert.equal(capped.outputLimitExceeded, true);
    assert.ok(Buffer.byteLength(capped.stdout) <= 4 * 1024 * 1024);
  });
}))));

// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md
test('output limit escalates TERM-resistant commands without waiting for the command timeout', () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const root = yield* consumer;
  const started = yield* Effect.sync(() => Date.now());
  const result = yield* runOwnedProcess(['node', '-e', "process.on('SIGTERM',()=>{});process.stdout.write('x'.repeat(5*1024*1024));setInterval(()=>{},1000)"], { cwd: root }).pipe(Effect.provide(OwnedProcessLive));
  yield* Effect.sync(() => {
    assert.equal(result.outputLimitExceeded, true);
    assert.equal(result.groupCleanup.gone, true);
    assert.ok(Date.now() - started < 3000, 'output limit must trigger bounded shutdown promptly');
  });
}))));
