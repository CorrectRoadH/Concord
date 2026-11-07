import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { tmpdir } from '../support/temporary.ts';
import { LocalRepository } from '../support/repository.ts';
import { closeIssue, linkIssue } from '../../src/domain/issues/index.ts';
import { decodeDocumentSource, loadDocuments } from '../../src/domain/documents/index.ts';
import { linkMemory } from '../../src/app/index.ts';
import { ConcordError, renderDocument } from '../../src/model/index.ts';
import { makeRuntimeEnvironment as makeParserRuntime } from '../../src/base/environment/index.ts';
const parserRuntime = makeParserRuntime(process.cwd(), process.env);


async function fixture(run: (repo: LocalRepository, root: string, write: (path: string, source: string) => void) => void) {
  const root = mkdtempSync(join(tmpdir(), 'concord-current-owner-'));
  execFileSync('git', ['init', '-q', root]);
  const write = (path: string, source: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), source); };
  const repo = (await LocalRepository.open(root));
  try { await run(repo, root, write); } finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
}
const code = (expected: string) => (cause: unknown) => cause instanceof ConcordError && cause.code === expected;

// @use-case docs/feature/feedback/use-case/manage-local-observations.md#close
test('handled Issue deletion is atomic, previews without writing and rejects authored inbound links', async () => (await fixture(async (repo, root, write) => {
  write('docs/issues/one.md', '# One\n\nA local observation.\n');
  write('docs/issues/two.md', '# Two\n');
  (await linkIssue(repo, 'two', 'docs/issues/one.md', false, 'related'));
  (await assert.rejects(async () => (await closeIssue(repo, 'one', 'Done')), code('IssueReferenced')));
  write('docs/issues/two.md', '# Two\n\nRead [one][issue].\n\n[issue]: one.md\n');
  (await assert.rejects(async () => (await closeIssue(repo, 'one', 'Done')), cause => code('IssueReferenced')(cause) && (cause as ConcordError).details !== undefined));
  write('docs/issues/two.md', '# Two\n');
  const preview = (await closeIssue(repo, 'one', 'Done', true));
  assert.equal(preview.dryRun, true);
  assert.equal(existsSync(join(root, 'docs/issues/one.md')), true);
  const closed = (await closeIssue(repo, 'one', 'Done'));
  assert.equal(existsSync(join(root, 'docs/issues/one.md')), false);
  assert.match(closed.conclusion, /Closed docs\/issues\/one.md\nReason: Done/u);
})));

// @use-case docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md#edit
test('Memory contains only supports relations and rejects retired metadata without compatibility decoding', async () => (await fixture(async (repo, root, write) => {
  write('docs/feature/cart/README.md', '# Cart\n');
  write('memory/cache.md', '# Cache\n\nKeep derived data disposable.\n');
  (await linkMemory(repo, 'cache', 'docs/feature/cart/README.md'));
  const source = readFileSync(join(root, 'memory/cache.md'), 'utf8');
  assert.match(source, /role: supports/u);
  assert.doesNotMatch(source, /type:|status:|supersededBy:/u);
  for (const field of ['type: insight', 'status: current', 'supersededBy: memory/other.md']) assert.throws(() => decodeDocumentSource('memory/cache.md', `---\n${field}\n---\n# Cache\n`, parserRuntime), code('InvalidData'));
  const record = decodeDocumentSource('memory/cache.md', '# Cache\n', parserRuntime)!;
  assert.equal(renderDocument(record.metadata, '# Cache\n'), '# Cache\n');
})));

// @use-case docs/feature/local-sdlc/use-case/compare-design-plans.md#create
test('Design discovery owns one Markdown file and Research pages have no document category', async () => (await fixture((repo, _root, write) => {
  write('docs/design/cache.md', '# Cache choices\n\nCompare bounded alternatives.\n');
  write('docs/research/cache/README.md', '# Plain document\n');
  const owners = loadDocuments(repo);
  assert.deepEqual(owners.map(owner => [owner.path, owner.metadata.kind]), [['docs/design/cache.md', 'design']]);
  assert.equal(decodeDocumentSource('docs/research/cache/README.md', '# Plain document\n', parserRuntime), undefined);
})));
