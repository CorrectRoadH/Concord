import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { Effect } from 'effect';
import { NodeFileSystem } from '@effect/platform-node';
import { applyDocumentMigration, type MigrationPlan } from '../scripts/migrate-documents.js';
import { digest } from '../src/shared.js';
import { LocalRepository } from '../src/storage.js';
import { loadDocuments } from '../src/documents.js';
import { prepareConfigMigration, applyConfigMigration } from '../scripts/migrate-config.js';

function fixture(t: TestContext): MigrationPlan {
  const root = mkdtempSync(join(tmpdir(), 'concord-document-migration-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path: string, value: string): void => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); };
  execFileSync('git', ['init', '-q', root]);
  write('concord.json', JSON.stringify({ format: 'concord.project/v1', projectId: 'migration-test', testRoots: [], runner: { kind: 'node-test', sourceFiles: [], timeoutMs: 60000 } }));
  const oldMemory = '# Existing problem\n\nOriginal body.\n';
  const oldIssue = '# Existing observation\n\nOriginal observation.\n';
  write('memory/problem.md', oldMemory);
  write('feedback/observation/README.md', oldIssue);
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, '-c', 'user.name=Concord Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']);
  const at = '2026-09-14T00:00:00.000Z';
  const owner = (metadata: object, body: string): string => `---\n${JSON.stringify({ format: 'concord.document/v1', createdAt: at, ...metadata })}\n---\n${body}`;
  const changes = [
    { path: 'memory/problem.md', beforeDigest: digest(oldMemory), after: owner({ id: 'problem', title: 'Existing problem', kind: 'memory', memoryKind: 'problem', state: 'captured', epoch: 0, promotions: [], history: [] }, oldMemory) },
    { path: 'feedback/observation/README.md', beforeDigest: digest(oldIssue), after: null },
    { path: 'docs/issues/observation.md', beforeDigest: null, after: owner({ id: 'observation', title: 'Existing observation', kind: 'issue', state: 'draft', memoryRelations: [], adoptions: { current: [], history: [] }, history: [] }, oldIssue) },
  ];
  return {
    format: 'concord.document-migration/v1', root, head: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), at,
    inputs: [{ path: 'feedback/observation/README.md', digest: digest(oldIssue) }, { path: 'memory/problem.md', digest: digest(oldMemory) }],
    outputs: changes.filter(change => change.after !== null).map(change => ({ path: change.path, digest: digest(change.after!) })).sort((a, b) => a.path < b.path ? -1 : 1),
    changes, counts: { memory: 1, researchFiles: 0, issues: 1 },
  };
}

test('offline migration publishes current owners, deletes old paths, and verifies repeats and drift', async t => {
  const plan = fixture(t);
  const apply = () => Effect.runPromise(applyDocumentMigration(plan).pipe(Effect.provide(NodeFileSystem.layer)));
  assert.equal((await apply()).status, 'applied');
  assert.equal(existsSync(join(plan.root, 'feedback/observation/README.md')), false);
  for (const change of plan.changes) if (change.after !== null) assert.equal(readFileSync(join(plan.root, change.path), 'utf8'), change.after);
  const configPlan = await Effect.runPromise(prepareConfigMigration(plan.root).pipe(Effect.provide(NodeFileSystem.layer)));
  await Effect.runPromise(applyConfigMigration(configPlan).pipe(Effect.provide(NodeFileSystem.layer)));
  const repository = new LocalRepository(plan.root, { dryRun: true });
  try { assert.deepEqual(loadDocuments(repository).map(document => document.metadata.kind).sort(), ['issue', 'memory']); }
  finally { repository.close(); }
  assert.equal((await apply()).status, 'already-applied');
  writeFileSync(join(plan.root, 'memory/unplanned.md'), '# External addition\n');
  await assert.rejects(apply(), /complete document file set|bytes changed/);
  assert.equal(readFileSync(join(plan.root, 'memory/unplanned.md'), 'utf8'), '# External addition\n');
});

test('a stale migration input rejects the entire plan before changing any owner', async t => {
  const plan = fixture(t);
  const before = readFileSync(join(plan.root, 'memory/problem.md'), 'utf8');
  writeFileSync(join(plan.root, 'feedback/observation/README.md'), '# External edit\n');
  await assert.rejects(Effect.runPromise(applyDocumentMigration(plan).pipe(Effect.provide(NodeFileSystem.layer))), /complete document file set|bytes changed/);
  assert.equal(readFileSync(join(plan.root, 'memory/problem.md'), 'utf8'), before);
  assert.equal(existsSync(join(plan.root, 'docs/issues/observation.md')), false);
  assert.equal(readFileSync(join(plan.root, 'feedback/observation/README.md'), 'utf8'), '# External edit\n');
});
