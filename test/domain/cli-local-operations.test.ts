import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { Schema } from 'effect';
import { adoptRoadmap, executeQuery, executeViewAction, getWorkspaceSnapshot, linkMemory } from '../../src/app/index.ts';
import { renderWritingPolicy } from '../../src/model/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { createDocument } from '../support/operations.ts';
import { LocalRepository, runApplication } from '../support/repository.ts';
import { readProjectConfig, writeProjectConfig } from '../support/support.ts';

const Show = Schema.Struct({ complete: Schema.Boolean, codeDeclarations: Schema.Array(Schema.Unknown), incoming: Schema.Array(Schema.Unknown) });
const Feedback = Schema.Struct({ complete: Schema.Boolean, findings: Schema.Array(Schema.Unknown) });
const State = Schema.Struct({ state: Schema.String });
const Writing = Schema.Struct({ scopes: Schema.Array(Schema.Struct({ scope: Schema.String })) });
const Concepts = Schema.Struct({ concepts: Schema.Array(Schema.Struct({ reference: Schema.String })) });
const Check = Schema.Struct({ ok: Schema.Boolean });

function write(root: string, path: string, source: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), source);
}

async function owner(root: string, kind: 'feature' | 'issue', id: string): Promise<void> {
  const repo = (await LocalRepository.open(root));
  try { (await createDocument(repo, kind, { id, title: id })); }
  finally { repo.close(); }
}

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('partial relationships never assign a malformed nested owner page to its healthy ancestor', async () => {
  const root = (await createConsumer());
  (await owner(root, 'feature', 'parent'));
  writeProjectConfig(root, { ...(await readProjectConfig(root)), sourceRoots: ['src'] });
  write(root, 'docs/feature/parent/nested/README.md', '---\nformat: concord.document/v1\nkind: feature\n---\n# Broken\n');
  const reference = 'docs/feature/parent/nested/page.md';
  write(root, reference, '# Page\n');
  write(root, 'src/declared.ts', `// @concord-file\n// @concord-implements ${reference}\nexport const value = 1;\n`);
  await assert.rejects(runApplication(executeViewAction(root, { action: 'code.marker', scope: 'file', contracts: [reference] })));
  const reply = await runApplication(executeQuery(root, { name: 'documents.show', input: { id: 'docs/feature/parent/README.md' } }, 'off'));
  assert.equal(reply.exitCode, 0);
  const show = Schema.decodeUnknownSync(Show)(reply.value);
  assert.equal(show.complete, false);
  assert.deepEqual(show.codeDeclarations, []);
  assert.deepEqual(show.incoming, []);
  const workspace = await runApplication(getWorkspaceSnapshot(root));
  assert.equal(workspace.complete, false);
  assert.ok(workspace.documents.some(document => document.path === 'docs/feature/parent/README.md'));
  assert.ok(workspace.findings.some(finding => finding.path === 'src/declared.ts'));
  assert.equal(workspace.edges.some(edge => edge.relation === 'implements'), false);
});

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('feedback show carries completeness for healthy and partial relationships', async () => {
  const root = (await createConsumer());
  (await owner(root, 'issue', 'feedback'));
  const request = { name: 'feedback.show', input: { id: 'feedback' } } as const;
  const healthy = Schema.decodeUnknownSync(Feedback)((await runApplication(executeQuery(root, request, 'off'))).value);
  assert.equal(healthy.complete, true);
  write(root, 'test/unresolved.ts', '// @feature docs/feature/missing/README.md\n');
  const partial = Schema.decodeUnknownSync(Feedback)((await runApplication(executeQuery(root, request, 'off'))).value);
  assert.equal(partial.complete, false);
  assert.ok(partial.findings.length > 0);
});

// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
test('scoped Markdown owners are discovered after direct editing', async () => {
  const root = (await createConsumer());
  const ownerPath = 'docs/feature/sample/writing.md';
  const catalogPath = 'docs/feature/sample/concepts.md';
  const missing = await runApplication(executeQuery(root, { name: 'writing.show', input: { path: ownerPath } }, 'off'));
  assert.equal(Schema.decodeUnknownSync(State)(missing.value).state, 'missing');
  write(root, ownerPath, renderWritingPolicy({ bannedTerms: [] }));
  write(root, catalogPath, '# Terms\n\n## Feedback {#feedback}\n\nA response\n');
  write(root, 'docs/feature/sample/page.md', 'Feedback.\n');
  const shown = await runApplication(executeQuery(root, { name: 'concepts.show', input: { path: catalogPath } }, 'off'));
  assert.equal(Schema.decodeUnknownSync(State)(shown.value).state, 'valid');
  const writing = await runApplication(executeQuery(root, { name: 'writing.index', input: {} }, 'off'));
  assert.ok(Schema.decodeUnknownSync(Writing)(writing.value).scopes.some(item => item.scope === 'docs/feature/sample'));
  const concepts = await runApplication(executeQuery(root, { name: 'concepts.index', input: {} }, 'off'));
  assert.ok(Schema.decodeUnknownSync(Concepts)(concepts.value).concepts.some(item => item.reference === `${catalogPath}#feedback`));
  const checked = await runApplication(executeViewAction(root, { action: 'writing.check', path: ownerPath }));
  assert.equal(Schema.decodeUnknownSync(Check)(checked).ok, true);
});

// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('Roadmap adoption retains selected pages and Memory supports Engineering', async () => {
  const root = (await createConsumer());
  const repo = (await LocalRepository.open(root));
  try {
    (await createDocument(repo, 'engineering', { id: 'release', title: 'Release' }));
    (await createDocument(repo, 'roadmap', { id: 'session', title: 'Session', pages: ['architecture'] }));
    assert.ok((await adoptRoadmap(repo, 'session')).changedPaths.includes('docs/feature/session/architecture.md'));
    assert.equal(existsSync(join(root, 'docs/feature/session/architecture.md')), true);
    (await createDocument(repo, 'memory', { id: 'release-owner', title: 'Release owner' }));
    (await linkMemory(repo, 'release-owner', 'docs/engineering/release/README.md', 'supports'));
  } finally { repo.close(); }
  const shown = await runApplication(executeQuery(root, { name: 'documents.show', input: { id: 'session' } }, 'off'));
  assert.equal(Schema.decodeUnknownSync(Schema.Struct({ document: Schema.Struct({ path: Schema.String }) }))(shown.value).document.path, 'docs/feature/session/README.md');
  await assert.rejects(runApplication(executeViewAction(root, { action: 'test.marker', contract: 'docs/engineering/release/README.md', issues: [] })), { code: 'InvalidReferenceTarget' });
  const checked = await runApplication(executeQuery(root, { name: 'check', input: {} }, 'off'));
  assert.equal(checked.exitCode, 0);
  assert.equal(Schema.decodeUnknownSync(Check)(checked.value).ok, true);
});
