import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { Effect } from 'effect';
import { executeViewAction, getViewFile, getWorkspaceSnapshot } from '../dist/application.js';
import { inspectDocuments, setMarkdown, setMetadata } from '../dist/editing.js';
import { inspectLegacyView } from '../dist/legacy-view.js';
import { digest } from '../dist/shared.js';
import { LocalRepository } from '../dist/storage.js';

function write(root: string, path: string, source: string): void {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, source);
}

function node(kind: string, title: string, relations = '{}'): string {
  return `---\nformat: niceeval.docs-node/v1\nkind: ${kind}\nrelations: ${relations}\n---\n\n# ${title}\n\nOriginal bytes: ${title}\n`;
}

function fixture(): { readonly root: string; readonly repo: LocalRepository; readonly sources: ReadonlyMap<string, string> } {
  const root = mkdtempSync(join(tmpdir(), 'concord-legacy-view-'));
  execFileSync('git', ['init', '-q', root]);
  write(root, 'concord.json', `${JSON.stringify({
    format: 'concord.project/v1', projectId: 'legacy-view-fixture', testRoots: [], sourceRoots: [],
    runner: { kind: 'node-test', sourceFiles: [], timeoutMs: 60000 },
  }, null, 2)}\n`);
  write(root, 'concord.repository.json', '{"format":"concord.repository/v1","host":"missing-host.ts"}\n');
  const sources = new Map<string, string>([
    ['docs/feature/outer/README.md', node('feature', 'Outer Feature')],
    ['docs/feature/outer/inner/README.md', node('feature', '内层 Feature')],
    ['docs/feature/outer/guide.md', '# Outer guide\n\nUnicode 保留\n'],
    ['docs/feature/outer/inner/guide.md', '# Inner guide\n\nSame basename\n'],
    ['docs/feature/outer/inner/你好.md', '# 你好\n\nUnicode path\n'],
    ['docs/feature/outer/inner/use-case/查看.md', node('use-case', '查看流程')],
    ['docs/feature/use-case/跨Feature.md', node('use-case', '跨 Feature', '{"composes":["docs/feature/outer/README.md","docs/feature/outer/inner/README.md"]}')],
    ['docs/design/legacy/README.md', node('design', 'Legacy Design')],
    ['docs/design/legacy/notes.md', '# Legacy design notes\n'],
  ]);
  for (const [path, source] of sources) write(root, path, source);
  const repo = new LocalRepository(root);
  return { root, repo, sources };
}

function code(code: string, operation: () => unknown): void {
  assert.throws(operation, error => typeof error === 'object' && error !== null && 'code' in error && error.code === code);
}

// @concord-case legacy-view-static-projection
// @concord-contract docs/feature/local-sdlc/use-case/load-compatible-repository-profile.md
test('projects old Features and attributable Use Cases by deepest owner without loading host code', async () => {
  const { root, repo, sources } = fixture();
  try {
    const inventory = inspectLegacyView(repo);
    assert.deepEqual(inventory.documents.filter(item => item.kind === 'feature').map(item => item.path), [
      'docs/feature/outer/inner/README.md', 'docs/feature/outer/README.md',
    ]);
    const inner = inventory.documents.find(item => item.path === 'docs/feature/outer/inner/README.md');
    const normalUseCase = inventory.documents.find(item => item.path.endsWith('/查看.md'));
    const crossUseCase = inventory.documents.find(item => item.path.endsWith('/跨Feature.md'));
    assert.equal(normalUseCase?.featurePath, inner?.path, 'Use Case must use the deepest valid Feature owner');
    assert.equal(crossUseCase?.featurePath, undefined, 'cross-Feature composes must not attach to one Feature');
    assert.equal(inner?.readOnly, true);
    assert.equal(inner?.body, sources.get(inner!.path), 'projection returns exact original bytes');
    assert.equal(inner?.digest, digest(sources.get(inner!.path)!));
    assert.equal(inventory.pageOwners.get('docs/feature/outer/guide.md'), 'docs/feature/outer/README.md');
    assert.equal(inventory.pageOwners.get('docs/feature/outer/inner/guide.md'), inner?.path);
    assert.equal(inventory.pageOwners.get('docs/feature/outer/inner/你好.md'), inner?.path);
    assert.equal(inventory.pageOwners.get('docs/design/legacy/notes.md'), 'docs/design/legacy/README.md');

    const inspected = inspectDocuments(repo);
    assert.equal(inspected.documents.some(document => document.path === inner?.path), false, 'old node must not become concord.document/v1');
    assert.equal(inspected.pages.find(page => page.path === 'docs/feature/outer/inner/guide.md')?.readOnly, true);
    const before = readFileSync(join(root, 'docs/feature/outer/inner/README.md'), 'utf8');
    code('ReadOnlyDocument', () => setMarkdown(repo, inner!.path, 'overwritten\n', inner!.digest));
    code('ReadOnlyDocument', () => setMarkdown(repo, 'docs/feature/outer/inner/你好.md', 'overwritten\n', digest(sources.get('docs/feature/outer/inner/你好.md')!)));
    code('ReadOnlyDocument', () => setMetadata(repo, inner!.path, { title: 'mutated' }, inner!.digest));
    assert.equal(readFileSync(join(root, 'docs/feature/outer/inner/README.md'), 'utf8'), before);

    repo.close();
    const snapshot = await Effect.runPromise(getWorkspaceSnapshot(root));
    assert.equal(snapshot.legacyDocuments.length, 4);
    assert.equal(snapshot.documents.length, 0);
    assert.equal(snapshot.legacyDocuments.find(item => item.path === inner?.path)?.kind, 'feature');
    const file = await Effect.runPromise(getViewFile(root, 'docs/feature/outer/inner/你好.md'));
    assert.equal(file.readOnly, true);
    assert.equal(file.body, sources.get(file.path));
    code('ReadOnlyDocument', () => Effect.runSync(executeViewAction(root, {
      action: 'document.set', path: 'docs/feature/outer/inner/你好.md', body: 'changed\n', expectedDigest: file.digest,
    })));
    assert.equal(readFileSync(join(root, 'docs/feature/outer/inner/你好.md'), 'utf8'), sources.get(file.path));
  } finally {
    repo.close();
    rmSync(root, { recursive: true, force: true });
  }
});
