import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { getWorkspaceSnapshot } from '../dist/application.js';
import { createDocument, diagnoseDocuments, readDocumentReference, readDocumentSelector, renderDocument } from '../dist/documents.js';
import { editKnowledge } from '../dist/knowledge.js';
import { LocalRepository, initialize } from '../dist/storage.js';
import { acquireTraceLeaseSync, releaseTraceLeaseSync } from '../dist/coordination.js';
import { beginRun } from '../dist/run-coordination.js';
import { setSource } from '../dist/editing.js';
import { digest } from '../dist/shared.js';
import { readProjectConfig, writeProjectConfig } from './support.js';

const cli = resolve('dist/entry.js');

function withConsumer(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'concord-operation-boundaries-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    const initial = new LocalRepository(root, { initialize: true });
    try { initialize(initial); } finally { initial.close(); }
    run(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

async function withConsumerAsync(run: (root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'concord-operation-boundaries-web-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    const initial = new LocalRepository(root, { initialize: true });
    try { initialize(initial); } finally { initial.close(); }
    await run(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

function withRepo(root: string, run: (repo: LocalRepository) => void, access: 'read' | 'write' = 'write'): void {
  const repo = new LocalRepository(root, { access });
  try { run(repo); } finally { repo.close(); }
}

function write(root: string, path: string, source: string): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, source);
}

function throwsCode(code: string, operation: () => unknown): void {
  assert.throws(operation, error => typeof error === 'object' && error !== null && 'code' in error && error.code === code);
}

function call(root: string, args: readonly string[], status: number, input = ''): { readonly status: number | null; readonly stdout: string; readonly stderr: string } {
  const result = spawnSync(process.execPath, [cli, '--root', root, '--json', ...args], { input, encoding: 'utf8', timeout: 20_000 });
  assert.equal(result.status, status, JSON.stringify({ args, stdout: result.stdout, stderr: result.stderr, error: result.error }));
  return result;
}

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('exact references accept ordinary YAML pages and reject malformed, historical, and misplaced owners', () => Effect.runPromise(Effect.sync(() => withConsumer(root => {
  withRepo(root, repo => {
    createDocument(repo, 'feature', { id: 'alpha', title: 'Alpha', pages: [] });
    createDocument(repo, 'feature', { id: 'beta', title: 'Beta', pages: [] });
    createDocument(repo, 'use-case', { id: 'flow', title: 'Flow', feature: 'alpha' });
    const alpha = readDocumentReference(repo, 'docs/feature/alpha/README.md', ['feature']);
    write(root, 'docs/feature/alpha/guide.md', '---\ntitle: Human guide\n---\n\n# Guide\n\n## Allowed anchor\n');
    assert.equal(readDocumentReference(repo, 'docs/feature/alpha/guide.md#allowed-anchor', ['feature']).path, alpha.path);

    write(root, 'docs/feature/alpha/nested/README.md', '---\nformat: concord.document/v1\nkind: feature\n---\n# Broken owner\n');
    write(root, 'docs/feature/alpha/nested/page.md', '# Nested page\n');
    throwsCode('InvalidData', () => readDocumentReference(repo, 'docs/feature/alpha/nested/page.md', ['feature']));
    throwsCode('InvalidData', () => readDocumentReference(repo, 'docs/feature/alpha/nested/README.md', ['feature']));

    write(root, 'memory/historical-feature.md', renderDocument(alpha.metadata, alpha.body));
    throwsCode('InvalidReferenceTarget', () => readDocumentReference(repo, 'memory/historical-feature.md', ['feature']));

    const flow = readDocumentReference(repo, 'docs/feature/alpha/use-case/flow.md', ['use-case']);
    write(root, 'docs/feature/beta/use-case/misplaced.md', renderDocument(flow.metadata, flow.body));
    throwsCode('InvalidPlacement', () => readDocumentReference(repo, 'docs/feature/beta/use-case/misplaced.md', ['use-case']));
  });
}))));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('canonical Issue edit ignores a malformed sibling while short IDs still require an unambiguous inventory', () => Effect.runPromise(Effect.sync(() => withConsumer(root => {
  withRepo(root, repo => {
    createDocument(repo, 'issue', { id: 'target', title: 'Target' });
    const path = 'docs/issues/target.md';
    const record = readDocumentSelector(repo, path, 'issue');
    write(root, 'docs/issues/broken.md', '---\nformat: concord.document/v1\nkind: issue\n---\n# Broken\n');
    const receipt = editKnowledge(repo, 'issue', path, '# Updated issue\n', record.digest);
    assert.deepEqual(receipt.changedPaths, [path]);
    assert.match(readFileSync(join(root, path), 'utf8'), /Updated issue/u);
    throwsCode('InvalidData', () => readDocumentSelector(repo, 'target', 'issue'));
    rmSync(join(root, 'docs/issues/broken.md'));
    write(root, 'docs/issues/second.md', readFileSync(join(root, path), 'utf8'));
    throwsCode('AmbiguousDocument', () => readDocumentSelector(repo, 'target', 'issue'));
    assert.equal(readDocumentSelector(repo, path, 'issue').path, path);
  });
}))));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('CLI and action preserve partial inventory diagnostics and healthy documents', () => Effect.runPromise(Effect.sync(() => withConsumer(root => {
    withRepo(root, repo => createDocument(repo, 'feature', { id: 'healthy', title: 'Healthy', pages: [] }));
    const bad = 'docs/feature/broken/README.md';
    write(root, bad, '---\nformat: concord.document/v1\nkind: feature\n---\n# Broken\n');
    withRepo(root, repo => {
      const inventory = diagnoseDocuments(repo);
      assert.equal(inventory.complete, false);
      assert.ok(inventory.documents.some(document => document.path === 'docs/feature/healthy/README.md'));
      assert.ok(inventory.findings.some(finding => finding.path === bad && finding.code === 'InvalidData'));
    }, 'read');
    const command = JSON.parse(call(root, ['check'], 1).stdout) as { ok: boolean; complete?: boolean; documents: number; findings: { path: string; code: string }[] };
    assert.equal(command.ok, false);
    assert.ok(command.documents >= 1);
    assert.ok(command.findings.some(finding => finding.path === bad && finding.code === 'InvalidData'));
    const action = JSON.parse(call(root, ['action', '--input', '-'], 0, JSON.stringify({ action: 'check' })).stdout) as { ok: boolean; complete?: boolean; documents: number; findings: { path: string; code: string }[] };
    assert.equal(action.ok, false);
    assert.ok(action.documents >= 1);
    assert.ok(action.findings.some(finding => finding.path === bad && finding.code === 'InvalidData'));
    assert.deepEqual([command.complete, action.complete], [false, false], 'CLI and action checks must state that their inventories are incomplete');
  }))));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('Web workspace retains complete=false, valid documents, and malformed owner findings', () => withConsumerAsync(async root => {
    withRepo(root, repo => createDocument(repo, 'feature', { id: 'healthy', title: 'Healthy', pages: [] }));
    const bad = 'docs/feature/broken/README.md';
    write(root, bad, '---\nformat: concord.document/v1\nkind: feature\n---\n# Broken\n');
    const snapshot = await Effect.runPromise(getWorkspaceSnapshot(root));
    assert.equal(snapshot.complete, false);
    assert.ok(snapshot.documents.some(document => document.path === 'docs/feature/healthy/README.md'));
    assert.ok(snapshot.findings.some(finding => finding.path === bad && finding.code === 'InvalidData'));
  }));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('read access refuses publication but permits a dry-run preview without writing', () => Effect.runPromise(Effect.sync(() => withConsumer(root => {
  withRepo(root, repo => {
    throwsCode('ReadOnlyRepository', () => createDocument(repo, 'feature', { id: 'blocked', title: 'Blocked', pages: [] }));
    assert.equal(existsSync(join(root, 'docs/feature/blocked')), false);
    const preview = createDocument(repo, 'feature', { id: 'preview', title: 'Preview', pages: [], dryRun: true });
    assert.equal(preview.dryRun, true);
    assert.deepEqual(preview.changedPaths, ['docs/feature/preview/README.md']);
    assert.equal(existsSync(join(root, 'docs/feature/preview')), false);
  }, 'read');
}))));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('read access cannot publish source or invalidate a run while another reader holds ownership', () => Effect.runPromise(Effect.sync(() => withConsumer(root => {
  write(root, 'test/source.ts', 'export const value = 1;\n');
  let runToken = '';
  withRepo(root, repo => { runToken = repo.snapshot(() => beginRun(root)).lease.owner.token; });
  const statePath = join(root, `.git/concord/run-${runToken}.json`);
  const state = readFileSync(statePath, 'utf8');
  const lease = acquireTraceLeaseSync(root, 'shared', 'other-reader')!;
  try {
    withRepo(root, repo => {
      const before = readFileSync(join(root, 'test/source.ts'), 'utf8');
      throwsCode('ReadOnlyRepository', () => setSource(repo, 'test/source.ts', 'changed\n', digest(before)));
      assert.equal(setSource(repo, 'test/source.ts', 'changed\n', digest(before), true).dryRun, true);
      assert.equal(readFileSync(join(root, 'test/source.ts'), 'utf8'), before);
      assert.equal(readFileSync(statePath, 'utf8'), state);
      assert.equal(existsSync(join(root, '.git/concord/journal.json')), false);
      assert.ok(existsSync(join(lease.path, `${lease.owner.token}.json`)));
    }, 'read');
  } finally { releaseTraceLeaseSync(lease, 'other-reader'); }
}))));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('partial relationships never assign a malformed nested owner page to its healthy ancestor', () => withConsumerAsync(async root => {
  withRepo(root, repo => createDocument(repo, 'feature', { id: 'parent', title: 'Parent', pages: [] }));
  writeProjectConfig(root, { ...readProjectConfig(root), sourceRoots: ['src'] });
  write(root, 'docs/feature/parent/nested/README.md', '---\nformat: concord.document/v1\nkind: feature\n---\n# Broken\n');
  const reference = 'docs/feature/parent/nested/page.md';
  write(root, reference, '# Page\n');
  write(root, 'src/declared.ts', `// @concord-file\n// @concord-implements ${reference}\nexport const value = 1;\n`);
  call(root, ['code', 'annotate', '--scope', 'file', '--contract', reference], 1);
  const show = JSON.parse(call(root, ['feature', 'show', 'parent'], 0).stdout) as { complete: boolean; codeDeclarations: unknown[]; incoming: unknown[] };
  assert.equal(show.complete, false);
  assert.deepEqual(show.codeDeclarations, []);
  assert.deepEqual(show.incoming, []);
  const workspace = await Effect.runPromise(getWorkspaceSnapshot(root));
  assert.equal(workspace.complete, false);
  assert.ok(workspace.documents.some(document => document.path === 'docs/feature/parent/README.md'));
  assert.ok(workspace.findings.some(finding => finding.path === 'src/declared.ts'));
  assert.equal(workspace.edges.some(edge => edge.relation === 'implements'), false);
}));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('feedback show carries complete for healthy and partial relationships', () => Effect.runPromise(Effect.sync(() => withConsumer(root => {
  withRepo(root, repo => createDocument(repo, 'issue', { id: 'feedback', title: 'Feedback' }));
  const healthy = JSON.parse(call(root, ['feedback', 'show', 'feedback'], 0).stdout) as { complete: boolean };
  assert.equal(healthy.complete, true);
  write(root, 'test/unresolved.ts', '// @feature docs/feature/missing/README.md\n');
  const partial = JSON.parse(call(root, ['feedback', 'show', 'feedback'], 0).stdout) as { complete: boolean; findings: unknown[] };
  assert.equal(partial.complete, false);
  assert.ok(partial.findings.length > 0);
}))));
