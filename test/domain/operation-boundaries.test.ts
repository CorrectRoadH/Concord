import { createDocument, initialize } from '../support/operations.js';
import { runApplication } from '../support/repository.js';
import { createConsumer } from '../support/consumer.js';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { getWorkspaceSnapshot } from "../../src/app/index.js";
import { diagnoseDocuments, readDocumentReference, readDocumentSelector } from "../../src/domain/documents/index.js";

import { renderDocument } from "../../src/model/index.js";
import { editKnowledge } from "../../src/app/index.js";
import { LocalRepository } from "../support/repository.js";

import { acquireTraceLeaseSync, releaseTraceLeaseSync } from "../../src/base/publication/index.js";
import { beginRun } from "../../src/base/publication/index.js";
import { setSource } from "../../src/app/index.js";
import { digest } from "../../src/model/index.js";
import { readProjectConfig, writeProjectConfig } from '../support/support.js';


function withConsumer(run: (root: string) => void): void {
  const root = createConsumer();
  try {
    run(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

async function withConsumerAsync(run: (root: string) => Promise<void>): Promise<void> {
  const root = createConsumer();
  try {
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

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('exact references derive identity from paths and reject malformed owners', () => runApplication(Effect.sync(() => withConsumer(root => {
  withRepo(root, repo => {
    createDocument(repo, 'feature', { id: 'alpha', title: 'Alpha', pages: [] });
    createDocument(repo, 'feature', { id: 'beta', title: 'Beta', pages: [] });
    createDocument(repo, 'use-case', { id: 'flow', title: 'Flow', feature: 'alpha' });
    const alpha = readDocumentReference(repo, 'docs/feature/alpha/README.md', ['feature']);
    write(root, 'docs/feature/alpha/guide.md', renderDocument(alpha.metadata, '# Guide\n\n## Allowed anchor\n'));
    assert.equal(readDocumentReference(repo, 'docs/feature/alpha/guide.md#allowed-anchor', ['feature']).path, alpha.path);

    write(root, 'docs/feature/alpha/nested/README.md', '---\nformat: concord.document/v1\nkind: feature\n---\n# Broken owner\n');
    write(root, 'docs/feature/alpha/nested/page.md', '# Nested page\n');
    throwsCode('InvalidData', () => readDocumentReference(repo, 'docs/feature/alpha/nested/page.md', ['feature']));
    throwsCode('InvalidData', () => readDocumentReference(repo, 'docs/feature/alpha/nested/README.md', ['feature']));

    write(root, 'memory/historical-feature.md', renderDocument(alpha.metadata, alpha.body));
    throwsCode('InvalidReferenceTarget', () => readDocumentReference(repo, 'memory/historical-feature.md', ['feature']));

    const flow = readDocumentReference(repo, 'docs/feature/alpha/use-case/flow.md', ['use-case']);
    write(root, 'docs/feature/beta/use-case/misplaced.md', renderDocument(flow.metadata, flow.body));
    const moved = readDocumentReference(repo, 'docs/feature/beta/use-case/misplaced.md', ['use-case']);
    assert.equal(moved.metadata.kind === 'use-case' ? moved.metadata.feature : undefined, 'docs/feature/beta/README.md');
  });
}))));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('canonical Issue edit ignores a malformed sibling while short IDs still require an unambiguous inventory', () => runApplication(Effect.sync(() => withConsumer(root => {
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
    assert.equal(readDocumentSelector(repo, 'target', 'issue').path, path);
    assert.equal(readDocumentSelector(repo, 'second', 'issue').path, 'docs/issues/second.md');
    assert.equal(readDocumentSelector(repo, path, 'issue').path, path);
  });
}))));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('Web workspace retains complete=false, valid documents, and malformed owner findings', () => withConsumerAsync(async root => {
    withRepo(root, repo => createDocument(repo, 'feature', { id: 'healthy', title: 'Healthy', pages: [] }));
    const bad = 'docs/feature/broken/README.md';
    write(root, bad, '---\nformat: concord.document/v1\nkind: feature\n---\n# Broken\n');
    const snapshot = await runApplication(getWorkspaceSnapshot(root));
    assert.equal(snapshot.complete, false);
    assert.ok(snapshot.documents.some(document => document.path === 'docs/feature/healthy/README.md'));
    assert.ok(snapshot.findings.some(finding => finding.path === bad && finding.code === 'InvalidData'));
  }));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('read access refuses publication but permits a dry-run preview without writing', () => runApplication(Effect.sync(() => withConsumer(root => {
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
test('read access cannot publish source or invalidate a run while another reader holds ownership', () => runApplication(Effect.sync(() => withConsumer(root => {
  writeProjectConfig(root, { testRoots: ['test'] });
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

