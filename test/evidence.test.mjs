import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { readEvidence, runCase, verifyFixedEvidence } from '../dist/evidence.js';
import { OwnedProcessLive, runOwnedProcess } from '../dist/owned-process.js';
import { loadDocuments } from '../dist/documents.js';
import { LocalRepository, initialize } from '../dist/storage.js';

function write(root, path, source) { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), source); }
function consumer() { const root = mkdtempSync(join(tmpdir(), 'concord-evidence-')); execFileSync('git', ['init', '-q', root]); const repo = new LocalRepository(root, { initialize: true }); initialize(repo); repo.close(); return root; }
const feature = `---\nformat: concord.document/v1\nid: example\ntitle: Example\ncreatedAt: 2026-01-01T00:00:00.000Z\nkind: feature\n---\n\nFeature\n`;
const problem = `---\nformat: concord.document/v1\nid: example-problem\ntitle: Problem\ncreatedAt: 2026-01-01T00:00:00.000Z\nkind: memory\nmemoryKind: problem\nstate: open\nepoch: 0\npromotions: []\nhistory: []\n---\n\nProblem\n`;
const selected = { id: 'example-case', file: 'test/example.test.mjs', line: 5, name: 'case', contract: 'docs/feature/example.md', regressions: ['memory/example-problem.md'], status: 'active', framework: 'node:test', skipped: false };
function setup(root, source = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { value } from '../fixture.mjs';\n// @concord-case example-case\n// @concord-contract docs/feature/example.md\n// @concord-regression memory/example-problem.md\ntest('case', () => assert.equal(value, true));\n") { write(root, 'docs/feature/example.md', feature); write(root, 'memory/example-problem.md', problem); write(root, 'fixture.mjs', 'export const value = false;\n'); write(root, selected.file, source); }
async function issue(repo, item = selected) { return Effect.runPromise(runCase(repo, item, loadDocuments(repo)).pipe(Effect.provide(OwnedProcessLive))); }

test('binds real red-to-green receipts and current fixed proof', async () => { const root = consumer(); try { setup(root); const repo = new LocalRepository(root); try { const red = await issue(repo); assert.equal(red.commandOutcome, 'fail', JSON.stringify(red)); assert.equal(red.execution, 'nonzero'); write(root, 'fixture.mjs', 'export const value = true;\n'); const green = await issue(repo); assert.equal(green.commandOutcome, 'pass', JSON.stringify(green)); assert.equal(green.execution, 'nonzero'); assert.equal(readEvidence(repo, green.id).implementationDigest, green.implementationDigest); const docs = loadDocuments(repo); assert.deepEqual(verifyFixedEvidence(repo, docs, [selected], docs.find((d) => d.path === 'memory/example-problem.md'), red.id, green.id), { red: red.id, green: green.id, selectedCaseId: selected.id, epoch: 0 }); } finally { repo.close(); } } finally { rmSync(root, { recursive: true, force: true }); } });

test('rejects all-skipped Node TAP execution', async () => { const root = consumer(); try { setup(root, "import { test } from 'node:test';\n// @concord-case example-case\n// @concord-contract docs/feature/example.md\n// @concord-regression memory/example-problem.md\ntest.skip('case', () => {});\n"); const repo = new LocalRepository(root); try { const receipt = await issue(repo); assert.equal(receipt.execution, 'skipped'); assert.equal(receipt.commandOutcome, 'invalid'); } finally { repo.close(); } } finally { rmSync(root, { recursive: true, force: true }); } });

test('preserves generic unknown and invalidates owner/candidate drift during commands', async () => { const root = consumer(); try { setup(root); const config = JSON.parse(readFileSync(join(root, 'concord.json'), 'utf8')); config.runner = { kind: 'command', argv: ['node', '-e', 'process.exit(0)'], sourceFiles: [], timeoutMs: 2000 }; write(root, 'concord.json', `${JSON.stringify(config)}\n`); let repo = new LocalRepository(root); try { const receipt = await issue(repo, { ...selected, framework: 'vitest' }); assert.equal(receipt.commandOutcome, 'pass'); assert.equal(receipt.execution, 'unknown'); } finally { repo.close(); }
  config.runner.argv = ['node', '-e', "require('node:fs').appendFileSync('docs/feature/example.md','changed')"]; write(root, 'concord.json', `${JSON.stringify(config)}\n`); repo = new LocalRepository(root); try { assert.equal((await issue(repo, { ...selected, framework: 'vitest' })).commandOutcome, 'invalid'); } finally { repo.close(); }
  write(root, 'docs/feature/example.md', feature); config.runner.argv = ['node', '-e', "require('node:fs').appendFileSync('fixture.mjs','changed')"]; write(root, 'concord.json', `${JSON.stringify(config)}\n`); repo = new LocalRepository(root); try { assert.equal((await issue(repo, { ...selected, framework: 'vitest' })).commandOutcome, 'invalid'); } finally { repo.close(); }
} finally { rmSync(root, { recursive: true, force: true }); } });

test('cleans timed-out process groups and bounds output', async () => { const root = consumer(); try { const timeout = await Effect.runPromise(Effect.scoped(runOwnedProcess(['node', '-e', 'setInterval(() => {}, 1000)'], { cwd: root, timeoutMs: 50 })).pipe(Effect.provide(OwnedProcessLive))); assert.equal(timeout.timedOut, true); assert.equal(timeout.groupCleanup.gone, true); const capped = await Effect.runPromise(Effect.scoped(runOwnedProcess(['node', '-e', "process.stdout.write('x'.repeat(5 * 1024 * 1024))"], { cwd: root, timeoutMs: 5000 })).pipe(Effect.provide(OwnedProcessLive))); assert.equal(capped.outputLimitExceeded, true); assert.ok(Buffer.byteLength(capped.stdout) <= 4 * 1024 * 1024); } finally { rmSync(root, { recursive: true, force: true }); } });

test('output limit escalates TERM-resistant commands without waiting for the command timeout', async () => {
  const root = consumer();
  try {
    const started = Date.now();
    const result = await Effect.runPromise(Effect.scoped(runOwnedProcess(['node', '-e', "process.on('SIGTERM',()=>{});process.stdout.write('x'.repeat(5*1024*1024));setInterval(()=>{},1000)"], { cwd: root, timeoutMs: 5000 })).pipe(Effect.provide(OwnedProcessLive)));
    assert.equal(result.outputLimitExceeded, true);
    assert.equal(result.groupCleanup.gone, true);
    assert.ok(Date.now() - started < 3000, 'output limit must trigger bounded shutdown promptly');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
