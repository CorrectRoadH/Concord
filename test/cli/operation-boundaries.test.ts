import { createDocument, initialize } from '../support/operations.js';
import { runApplication } from '../support/repository.js';
import { createConsumer } from '../support/consumer.js';
import { installedConcordCli } from '../support/support.js';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.js';
import { dirname, join, resolve } from 'node:path';
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

const cli = installedConcordCli();

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

function call(root: string, args: readonly string[], status: number, input = ''): { readonly status: number | null; readonly stdout: string; readonly stderr: string } {
  const result = spawnSync(process.execPath, [cli, '--root', root, '--json', ...args], { input, encoding: 'utf8', timeout: 20_000 });
  assert.equal(result.status, status, JSON.stringify({ args, stdout: result.stdout, stderr: result.stderr, error: result.error }));
  return result;
}

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('CLI and action preserve partial inventory diagnostics and healthy documents', () => runApplication(Effect.sync(() => withConsumer(root => {
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
test('partial relationships never assign a malformed nested owner page to its healthy ancestor', () => withConsumerAsync(async root => {
  withRepo(root, repo => createDocument(repo, 'feature', { id: 'parent', title: 'Parent', pages: [] }));
  writeProjectConfig(root, { ...readProjectConfig(root), sourceRoots: ['src'] });
  write(root, 'docs/feature/parent/nested/README.md', '---\nformat: concord.document/v1\nkind: feature\n---\n# Broken\n');
  const reference = 'docs/feature/parent/nested/page.md';
  write(root, reference, '# Page\n');
  write(root, 'src/declared.ts', `// @concord-file\n// @concord-implements ${reference}\nexport const value = 1;\n`);
  call(root, ['code', 'marker', '--scope', 'file', '--contract', reference], 1);
  const show = JSON.parse(call(root, ['show', 'docs/feature/parent/README.md'], 0).stdout) as { complete: boolean; codeDeclarations: unknown[]; incoming: unknown[] };
  assert.equal(show.complete, false);
  assert.deepEqual(show.codeDeclarations, []);
  assert.deepEqual(show.incoming, []);
  const workspace = await runApplication(getWorkspaceSnapshot(root));
  assert.equal(workspace.complete, false);
  assert.ok(workspace.documents.some(document => document.path === 'docs/feature/parent/README.md'));
  assert.ok(workspace.findings.some(finding => finding.path === 'src/declared.ts'));
  assert.equal(workspace.edges.some(edge => edge.relation === 'implements'), false);
}));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('feedback show carries complete for healthy and partial relationships', () => runApplication(Effect.sync(() => withConsumer(root => {
  withRepo(root, repo => createDocument(repo, 'issue', { id: 'feedback', title: 'Feedback' }));
  const healthy = JSON.parse(call(root, ['feedback', 'show', 'feedback'], 0).stdout) as { complete: boolean };
  assert.equal(healthy.complete, true);
  write(root, 'test/unresolved.ts', '// @feature docs/feature/missing/README.md\n');
  const partial = JSON.parse(call(root, ['feedback', 'show', 'feedback'], 0).stdout) as { complete: boolean; findings: unknown[] };
  assert.equal(partial.complete, false);
  assert.ok(partial.findings.length > 0);
}))));
