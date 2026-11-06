import { createDocument, initialize } from '../support/operations.ts';
import { runApplication } from '../support/repository.ts';
import { createConsumer } from '../support/consumer.ts';
import { runCli, type CliResult } from '../support/cli.ts';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { getWorkspaceSnapshot } from "../../src/app/index.ts";
import { diagnoseDocuments, readDocumentReference, readDocumentSelector } from "../../src/domain/documents/index.ts";

import { renderDocument } from "../../src/model/index.ts";
import { editKnowledge } from "../../src/app/index.ts";
import { LocalRepository } from "../support/repository.ts";

import { acquireTraceLeaseSync, releaseTraceLeaseSync } from "../../src/base/publication/index.ts";
import { beginRun } from "../../src/base/publication/index.ts";
import { setSource } from "../../src/app/index.ts";
import { digest } from "../../src/model/index.ts";
import { readProjectConfig, writeProjectConfig } from '../support/support.ts';

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

async function call(root: string, args: readonly string[], status: number, input = ''): Promise<CliResult> {
  const result = await runCli({ argv: ['--root', root, '--json', ...args], cwd: process.cwd(), env: process.env, stdin: input, signal: AbortSignal.timeout(20000) });
  assert.equal(result.exitCode, status, JSON.stringify({ args, stdout: result.stdout, stderr: result.stderr }));
  return result;
}

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('CLI and action preserve partial inventory diagnostics and healthy documents', () => runApplication(Effect.promise(() => withConsumerAsync(async root => {
    withRepo(root, repo => createDocument(repo, 'feature', { id: 'healthy', title: 'Healthy', pages: [] }));
    const bad = 'docs/feature/broken/README.md';
    write(root, bad, '---\nformat: concord.document/v1\nkind: feature\n---\n# Broken\n');
    withRepo(root, repo => {
      const inventory = diagnoseDocuments(repo);
      assert.equal(inventory.complete, false);
      assert.ok(inventory.documents.some(document => document.path === 'docs/feature/healthy/README.md'));
      assert.ok(inventory.findings.some(finding => finding.path === bad && finding.code === 'InvalidData'));
    }, 'read');
    const command = JSON.parse((await call(root, ['check'], 1)).stdout) as { ok: boolean; complete?: boolean; documents: number; findings: { path: string; code: string }[] };
    assert.equal(command.ok, false);
    assert.ok(command.documents >= 1);
    assert.ok(command.findings.some(finding => finding.path === bad && finding.code === 'InvalidData'));
    const action = JSON.parse((await call(root, ['action', '--input', '-'], 0, JSON.stringify({ action: 'check' }))).stdout) as { ok: boolean; complete?: boolean; documents: number; findings: { path: string; code: string }[] };
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
  await call(root, ['code', 'marker', '--scope', 'file', '--contract', reference], 1);
  const show = JSON.parse((await call(root, ['show', 'docs/feature/parent/README.md'], 0)).stdout) as { complete: boolean; codeDeclarations: unknown[]; incoming: unknown[] };
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
test('feedback show carries complete for healthy and partial relationships', () => runApplication(Effect.promise(() => withConsumerAsync(async root => {
  withRepo(root, repo => createDocument(repo, 'issue', { id: 'feedback', title: 'Feedback' }));
  const healthy = JSON.parse((await call(root, ['feedback', 'show', 'feedback'], 0)).stdout) as { complete: boolean };
  assert.equal(healthy.complete, true);
  write(root, 'test/unresolved.ts', '// @feature docs/feature/missing/README.md\n');
  const partial = JSON.parse((await call(root, ['feedback', 'show', 'feedback'], 0)).stdout) as { complete: boolean; findings: unknown[] };
  assert.equal(partial.complete, false);
  assert.ok(partial.findings.length > 0);
}))));
