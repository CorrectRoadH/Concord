import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { Effect } from 'effect';
import { NodeServices } from '@effect/platform-node';
import { runFeedbackCommand } from '../dist/repository/feedback/command.js';
import { NodeFeedbackStoreLive } from '../dist/repository/feedback/services.js';
import type { IssueMeta } from '../dist/shared.js';

function write(root: string, path: string, bytes: string | Uint8Array): void { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), bytes); }
function fixture(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), 'concord-repository-feedback-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', root]);
  mkdirSync(join(root, 'e2e'));
  write(root, 'concord.repository.json', JSON.stringify({ format: 'concord.repository/v2', suites: [{ id: 'suite', root: 'e2e' }], historyPath: 'test-history.ts', policy: 'concord.native-reliability/v1' }));
  for (const path of ['docs/issues/README.md', 'memory/README.md']) write(root, path, '# Navigation\n');
  write(root, 'docs/feature/flow/README.md', owner({ kind: 'feature', id: 'flow', title: 'Flow' }));
  write(root, 'memory/problem.md', owner({ kind: 'memory', id: 'problem', title: 'Problem', memoryKind: 'problem', state: 'open', epoch: 0, promotions: [], history: [] }));
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, '-c', 'user.name=Concord Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']);
  return root;
}
function owner(fields: object): string { return `---\n${JSON.stringify({ format: 'concord.document/v1', createdAt: '2026-09-14T00:00:00.000Z', ...fields })}\n---\n# Original body\n`; }
function issue(id: string): IssueMeta { return { format: 'concord.document/v1', id, title: id, createdAt: '2026-09-14T00:00:00.000Z', kind: 'issue', state: 'draft', memoryRelations: [], adoptions: { current: [], history: [] }, history: [] }; }
const run = (root: string, input: unknown) => Effect.runPromise(runFeedbackCommand(input).pipe(Effect.provide(NodeFeedbackStoreLive(root)), Effect.provide(NodeServices.layer)));

test('repository feedback uses canonical owners and validates links, adoption, closure and Git history', async t => {
  const root = fixture(t);
  const preview = await run(root, { operation: 'add', document: { metadata: issue('observation'), body: '# Account\n' }, dryRun: true });
  assert('receipt' in preview && 'committed' in preview.receipt && !preview.receipt.committed);
  assert.equal(existsSync(join(root, 'docs/issues/observation.md')), false);
  await run(root, { operation: 'add', document: { metadata: issue('observation'), body: '# Account\n' }, dryRun: false });
  renameSync(join(root, 'docs/issues/observation.md'), join(root, 'docs/issues/中文观察.md'));
  await run(root, { operation: 'link', id: 'observation', relation: { kind: 'investigation', memory: 'memory/problem.md' }, dryRun: false });
  await assert.rejects(run(root, { operation: 'close', id: 'observation', closure: { kind: 'fixed', memory: 'memory/problem.md', proof: ['account'] }, dryRun: false }), /resolved fixed Problem/);
  await assert.rejects(run(root, { operation: 'adopt', id: 'observation', to: 'docs/feature/missing/README.md', dryRun: false }), /missing|not found|ENOENT/);
  await run(root, { operation: 'adopt', id: 'observation', to: 'docs/feature/flow/README.md', dryRun: false });
  await run(root, { operation: 'retire', id: 'observation', from: 'docs/feature/flow/README.md', dryRun: false });
  const shown = await run(root, { operation: 'show', id: 'observation' });
  assert('document' in shown);
  assert.equal(shown.document.metadata.adoptions.history[0]?.commit, execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
  await run(root, { operation: 'close', id: 'observation', closure: { kind: 'closed', reason: 'Reviewed account' }, dryRun: false });
  const checked = await run(root, { operation: 'check' });
  assert('receipt' in checked && 'ok' in checked.receipt && checked.receipt.ok);
  assert.equal(existsSync(join(root, 'feedback')), false);
});

test('repository feedback rejects duplicate cycles, symlinks and invalid current metadata', async t => {
  const root = fixture(t);
  for (const id of ['first', 'second']) await run(root, { operation: 'add', document: { metadata: issue(id), body: '# Account\n' }, dryRun: false });
  await run(root, { operation: 'close', id: 'first', closure: { kind: 'duplicate', canonical: 'docs/issues/second.md' }, dryRun: false });
  await assert.rejects(run(root, { operation: 'close', id: 'second', closure: { kind: 'duplicate', canonical: 'docs/issues/first.md' }, dryRun: false }), /cycle/);
  symlinkSync(join(root, 'memory/problem.md'), join(root, 'docs/issues/unsafe.md'));
  await assert.rejects(run(root, { operation: 'show', id: 'unsafe' }), /symbolic links/);
});

test('dogfood import preserves binary artifacts and candidate facts, validates digests and repeats safely', async t => {
  const root = fixture(t);
  const artifacts = mkdtempSync(join(tmpdir(), 'concord-feedback-artifacts-'));
  t.after(() => rmSync(artifacts, { recursive: true, force: true }));
  const bytes = Buffer.from([0, 255, 13, 10, 128]);
  write(artifacts, 'capture.bin', bytes);
  const unsigned = { format: 'concord.feedback-envelope/v1', origin: { repository: 'acme/project', originId: 'run-1', commit: 'a'.repeat(40) }, candidate: { version: 'candidate-one' }, source: 'dogfood', observation: 'Original observation', impact: 'Original impact', artifacts: [{ path: 'capture.bin', byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }] };
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, canonical(value)])) : value;
  const envelope = { ...unsigned, digest: createHash('sha256').update(JSON.stringify(canonical(unsigned))).digest('hex') };
  await assert.rejects(run(root, { operation: 'import', envelope: { ...envelope, digest: 'bad' }, artifacts, dryRun: false }), /digest mismatch/);
  const imported = await run(root, { operation: 'import', envelope, artifacts, dryRun: false });
  assert('feedback' in imported && !Array.isArray(imported.feedback));
  if (!('receipt' in imported) || !('value' in imported.receipt)) throw new Error('Expected mutation');
  const id = imported.receipt.value.id;
  assert.deepEqual(readFileSync(join(root, `docs/issues/${id}/artifacts/capture.bin`)), bytes);
  assert.match(readFileSync(join(root, `docs/issues/${id}.md`), 'utf8'), /candidate-one/);
  await run(root, { operation: 'import', envelope, artifacts, dryRun: false });
  write(root, `docs/issues/${id}/artifacts/capture.bin`, 'external');
  await assert.rejects(run(root, { operation: 'import', envelope, artifacts, dryRun: false }), /artifact changed/);
  assert.equal(readFileSync(join(root, `docs/issues/${id}/artifacts/capture.bin`), 'utf8'), 'external');
});
