import { renderOwnerFixture } from './owner-fixture.js';
import { createConsumer } from './support/consumer.js';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { authorDesignFixture } from './design-fixture.js';
import {
  adoptRoadmap,
  activateMemory,
  addPage,
  checkDocuments,
  closeIssue,
  createDocument,
  decideDesign,
  findDocument,
  linkIssue,
  linkMemory,
  loadDocuments,
  parseDocumentRecord,
  renderDocument,
  resolveReference,
  setAuthor,
  setPage,
  showPage,
  supersedeMemory,
} from '../src/documents.js';
import { LocalRepository, initialize } from '../src/storage.js';
import { inspectDocuments } from '../src/editing.js';

function useConsumer(run: (repo: LocalRepository, root: string) => void): void {
  const root = createConsumer();
  const repo = new LocalRepository(root);
  try { return run(repo, root); }
  finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
}

function write(root: string, path: string, contents: string): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
}

function throwsCode(code: string, operation: () => unknown): void {
  assert.throws(operation, error => typeof error === 'object' && error !== null && 'code' in error && error.code === code);
}

test('shared owner decoding refuses frontmatter on a Spec owner', () => {
  const invalid = '---\nformat: concord.document/v1\nid: example\nkind: feature\n---\n# Body\n';
  throwsCode('InvalidData', () => parseDocumentRecord('docs/feature/示例/README.md', invalid));
});

// @feature docs/feature/local-sdlc/README.md
test('owner titles accept the declared boundary and reject multiline or oversized text', () => {
  for (const kind of ['feature', 'use-case', 'engineering'] as const) {
    const base = { format: 'concord.document/v1' as const, id: 'title-boundary', title: 'x'.repeat(1024) };
    const metadata = kind === 'use-case' ? { ...base, kind, feature: 'docs/feature/example/README.md' } : { ...base, kind };
    const source = renderDocument(metadata, `# ${base.title}\n`);
    const path = kind === 'use-case' ? 'docs/feature/example/use-case/title-boundary.md' : `docs/${kind}/title-boundary/README.md`;
    assert.equal(parseDocumentRecord(path, source)?.metadata.title.length, 1024);
    for (const title of ['x'.repeat(1025), 'First\nSecond', 'First\rSecond', 'First\u2028Second', 'First\u2029Second']) {
      throwsCode('InvalidData', () => renderDocument({ ...metadata, title }, '# Body\n'));
    }
  }
});
// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('creates strict owners, resolves feature supporting pages, and only replaces author prose', () => Effect.runPromise(Effect.sync(() => useConsumer((repo, root) => {
  createDocument(repo, 'feature', { id: 'login', title: 'Login', body: '# Login contract\n\nCurrent behavior.\n' });
  createDocument(repo, 'use-case', { id: 'expired-token', title: 'Expired token', body: '# Expired token\n', feature: 'login' });
  createDocument(repo, 'research', { id: 'session-study', title: 'Session study', body: '# Results\n', observedAt: '2026-09-13', sources: ['https://example.invalid/study'] });
  write(root, 'docs/feature/login/guide.md', '# Login guide\n\n## Token expiry\n');

  let documents = loadDocuments(repo);
  assert.equal(documents.length, 3);
  assert.equal(findDocument(documents, 'expired-token', 'use-case').path, 'docs/feature/login/use-case/expired-token.md');
  assert.equal(resolveReference(repo, documents, 'docs/feature/login/guide.md#token-expiry', ['feature']).metadata.id, 'login');
  throwsCode('InvalidReferenceTarget', () => resolveReference(repo, documents, 'docs/feature/login/use-case/expired-token.md', ['feature']));
  throwsCode('AnchorNotFound', () => resolveReference(repo, documents, 'docs/feature/login/guide.md#missing', ['feature']));

  const feature = findDocument(documents, 'login', 'feature');
  setAuthor(repo, feature.path, '# Login contract\n\nRevised behavior.\n', feature.digest);
  documents = loadDocuments(repo);
  const revised = findDocument(documents, 'login', 'feature');
  assert.match(revised.body, /Revised behavior/u);
  assert.deepEqual(revised.metadata, feature.metadata);
  throwsCode('PreimageChanged', () => setAuthor(repo, revised.path, '# Wrong preimage\n', feature.digest));
  throwsCode('InvalidAuthorBody', () => setAuthor(repo, revised.path, '---\ntitle: override\n---\n', revised.digest));
  assert.deepEqual(checkDocuments(repo, documents), []);
}))));
// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('same Use Case names are selected by canonical path when ambiguous', () => Effect.runPromise(Effect.sync(() => useConsumer(repo => {
  createDocument(repo, 'feature', { id: 'accounts', title: 'Accounts', body: '# Accounts\n' });
  createDocument(repo, 'feature', { id: 'sessions', title: 'Sessions', body: '# Sessions\n' });
  createDocument(repo, 'use-case', { id: 'sign-in', title: 'Account sign in', body: '# Sign in\n', feature: 'accounts' });
  createDocument(repo, 'use-case', { id: 'sign-in', title: 'Session sign in', body: '# Sign in\n', feature: 'sessions' });
  const documents = loadDocuments(repo);
  assert.equal(documents.filter(document => document.metadata.kind === 'use-case' && document.metadata.id === 'sign-in').length, 2);
  throwsCode('AmbiguousDocument', () => findDocument(documents, 'sign-in', 'use-case'));
  assert.deepEqual(checkDocuments(repo, documents), []);
}))));
// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('decides a design once and validates dry-run without writing', () => Effect.runPromise(Effect.sync(() => useConsumer(repo => {
  createDocument(repo, 'feature', { id: 'search', title: 'Search', body: '# Search\n' });
  createDocument(repo, 'design', { id: 'search-index', title: 'Search index', body: '# Options\n', alternatives: ['sqlite', 'memory'] });
  authorDesignFixture(repo.root, 'search-index', ['sqlite', 'memory'], 'sqlite');
  const decisionPath = join(repo.root, 'docs/design/search-index/DECISION.md');
  writeFileSync(decisionPath, readFileSync(decisionPath, 'utf8').replace(/^Selected:.*\n/mu, ''));
  const receipt = decideDesign(repo, 'search-index', 'sqlite', ['docs/feature/search/README.md'], 'Keeps local state rebuildable');
  assert.equal(receipt.operation, 'decide-design');
  let design = findDocument(loadDocuments(repo), 'search-index', 'design');
  assert.equal(design.metadata.kind === 'design' && design.metadata.decision?.selected, 'sqlite');
  throwsCode('DecisionExists', () => decideDesign(repo, 'search-index', 'memory', [], 'Changed mind'));

  const dry = createDocument(repo, 'research', { id: 'dry-study', title: 'Dry study', body: '# Dry\n', observedAt: '2026-09-13', dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.equal(loadDocuments(repo).some(document => document.metadata.id === 'dry-study'), false);
}))));
// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('creates template packages and protects supporting page preimages', () => Effect.runPromise(Effect.sync(() => useConsumer(repo => {
  const minimal = createDocument(repo, 'feature', { id: 'empty-selection', title: 'Empty selection', pages: [] });
  assert.deepEqual(minimal.changedPaths, ['docs/feature/empty-selection/README.md']);
  createDocument(repo, 'engineering', { id: 'ci', title: 'CI' });
  createDocument(repo, 'design', { id: 'cache', title: 'Cache', alternatives: ['sqlite', 'files'], pages: ['architecture'] });
  assert.ok(repo.read('docs/engineering/ci/README.md')?.includes('# CI'));
  assert.ok(repo.read('docs/design/cache/GOALS.md'));
  assert.ok(repo.read('docs/design/cache/plans/sqlite/architecture.md'));
  assert.ok(repo.read('docs/design/cache/plans/files/architecture.md'));
  const candidate = repo.read('docs/design/cache/plans/sqlite/README.md')!;
  rmSync(repo.absolute('docs/design/cache/plans/sqlite/README.md'));
  throwsCode('DesignPlanNotFound', () => addPage(repo, 'design', 'cache', 'readme', false, 'sqlite'));
  writeFileSync(repo.absolute('docs/design/cache/plans/sqlite/README.md'), candidate);
  assert.match(repo.read('docs/design/cache/plans/sqlite/README.md')!, /## Limits/u);
  assert.equal(repo.read('docs/engineering/ci/cli.md'), undefined);
  addPage(repo, 'engineering', 'ci', 'cli');
  const page = showPage(repo, 'engineering', 'ci', 'cli');
  assert.equal(page.path, 'docs/engineering/ci/cli.md');
  setPage(repo, 'engineering', 'ci', 'cli', '# CI command\n', page.digest);
  throwsCode('PreimageChanged', () => setPage(repo, 'engineering', 'ci', 'cli', '# stale\n', page.digest));
  throwsCode('InvalidPlan', () => addPage(repo, 'engineering', 'ci', 'library', false, 'sqlite'));
  const owner = showPage(repo, 'engineering', 'ci', 'readme');
  assert.match(owner.body, /## Goal/u);
  setPage(repo, 'engineering', 'ci', 'readme', '# CI\n\nUpdated.\n', owner.digest);
  assert.match(showPage(repo, 'engineering', 'ci', 'readme').body, /Updated/u);
  const plan = showPage(repo, 'design', 'cache', 'readme', 'sqlite');
  setPage(repo, 'design', 'cache', 'readme', '# SQLite plan\n', plan.digest, false, 'sqlite');
  throwsCode('InvalidDocumentKind', () => addPage(repo, 'memory', 'missing', 'cli'));
}))));
// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('uses the memoryKind template when body is omitted', () => Effect.runPromise(Effect.sync(() => useConsumer(repo => {
  createDocument(repo, 'memory', { id: 'stale', title: 'Stale cache', memoryKind: 'insight' });
  assert.match(findDocument(loadDocuments(repo), 'stale', 'memory').body, /## /u);
}))));

test('creates captured typed memories and activates without persisting lifecycle history', () => Effect.runPromise(Effect.sync(() => useConsumer(repo => {
  createDocument(repo, 'memory', { id: 'captured-note', title: 'Captured note', memoryKind: 'note' });
  throwsCode('InvalidMemoryState', () => activateMemory(repo, 'captured-note', 'confirm'));
  createDocument(repo, 'memory', { id: 'captured-insight', title: 'Captured insight', memoryKind: 'insight' });
  activateMemory(repo, 'captured-insight', 'Confirmed');
  const active = findDocument(loadDocuments(repo), 'captured-insight', 'memory');
  assert.equal(active.metadata.kind === 'memory' && active.metadata.status, 'current');
  assert.doesNotMatch(repo.read(active.path)!, /history:|createdAt:|format:|epoch:/u);
}))));
// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('adoption rebases supported links and rejects unsafe source packages without writing', () => Effect.runPromise(Effect.sync(() => useConsumer((repo, root) => {
  createDocument(repo, 'roadmap', { id: 'move', title: 'Move', body: '# Move\n\n[Other](../other/README.md)\n' });
  write(root, 'docs/roadmap/move/guide.md', '[Inner](nested.md) [Outer](../other/README.md)\n\n[outer]: ../other/README.md\n\n`[code](../other/README.md)`\n\n~~~md\n[example](../other/README.md)\n~~~\n\n    [indented](../other/README.md)\n');
  adoptRoadmap(repo, 'move', 'moved');
  const feature = findDocument(loadDocuments(repo), 'moved', 'feature');
  assert.match(feature.body, /\[Other\]\(\.\.\/\.\.\/roadmap\/other\/README\.md\)/u);
  const copied = repo.read('docs/feature/moved/guide.md');
  assert.ok(copied);
  assert.match(copied, /\[Inner\]\(nested\.md\) \[Outer\]\(\.\.\/\.\.\/roadmap\/other\/README\.md\)/u);
  assert.match(copied, /^\[outer\]: \.\.\/\.\.\/roadmap\/other\/README\.md/mu);
  assert.match(copied, /`\[code\]\(\.\.\/other\/README\.md\)`/u);
  assert.match(copied, /~~~md\n\[example\]\(\.\.\/other\/README\.md\)/u);
  assert.match(copied, /    \[indented\]\(\.\.\/other\/README\.md\)/u);
  createDocument(repo, 'roadmap', { id: 'attachment', title: 'Attachment', body: '# A\n' });
  write(root, 'docs/roadmap/attachment/data.json', '{}');
  throwsCode('UnsupportedAttachment', () => adoptRoadmap(repo, 'attachment', 'attachment-feature'));
  assert.equal(repo.read('docs/feature/attachment-feature/README.md'), undefined);
  createDocument(repo, 'roadmap', { id: 'nested', title: 'Nested', body: '# N\n' });
  write(root, 'docs/roadmap/nested/child.md', '---\ntitle: child\n---\n');
  throwsCode('InvalidData', () => adoptRoadmap(repo, 'nested', 'nested-feature'));
  assert.equal(repo.read('docs/feature/nested-feature/README.md'), undefined);
  rmSync(join(root, 'docs/roadmap/nested/child.md'));
  createDocument(repo, 'roadmap', { id: 'linked', title: 'Linked', body: '# L\n' });
  symlinkSync('../../other', join(root, 'docs/roadmap/linked/link'));
  throwsCode('UnsafePath', () => adoptRoadmap(repo, 'linked', 'linked-feature'));
  assert.equal(repo.read('docs/feature/linked-feature/README.md'), undefined);
}))));
// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('adoption detects a source-set change before publishing', () => Effect.runPromise(Effect.sync(() => useConsumer(repo => {
  createDocument(repo, 'roadmap', { id: 'drift', title: 'Drift', body: '# Drift\n' });
  let calls = 0;
  const unstable = new Proxy(repo, { get(target, key, receiver) {
    if (key !== 'files') return Reflect.get(target, key, receiver);
    return (prefix: string) => {
      const paths = target.files(prefix);
      if (prefix === 'docs/roadmap/drift' && ++calls === 2) return [...paths, 'docs/roadmap/drift/new.md'];
      return paths;
    };
  }});
  throwsCode('PreimageChanged', () => adoptRoadmap(unstable, 'drift', 'drift-feature'));
  assert.equal(repo.read('docs/feature/drift-feature/README.md'), undefined);
}))));
// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('adoption detects source bytes and destination conflicts before publishing', () => Effect.runPromise(Effect.sync(() => useConsumer((repo, root) => {
  createDocument(repo, 'roadmap', { id: 'bytes', title: 'Bytes', body: '# Bytes\n' });
  write(root, 'docs/roadmap/bytes/guide.md', '# Guide\n');
  let sourceCollection = false; let guideReads = 0;
  const unstable = new Proxy(repo, { get(target, key, receiver) {
    if (key === 'files') return (prefix: string) => { if (prefix === 'docs/roadmap/bytes') sourceCollection = true; return target.files(prefix); };
    if (key === 'read') return (path: string) => {
      const current = target.read(path);
      if (sourceCollection && path === 'docs/roadmap/bytes/guide.md' && ++guideReads === 2) return `${current}\nchanged`;
      return current;
    };
    return Reflect.get(target, key, receiver);
  }});
  throwsCode('PreimageChanged', () => adoptRoadmap(unstable, 'bytes', 'bytes-feature'));
  assert.equal(repo.read('docs/feature/bytes-feature/README.md'), undefined);
  createDocument(repo, 'roadmap', { id: 'conflict', title: 'Conflict', body: '# Conflict\n' });
  write(root, 'docs/roadmap/conflict/guide.md', '# Guide\n');
  write(root, 'docs/feature/conflicted/guide.md', '# Existing\n');
  throwsCode('DocumentExists', () => adoptRoadmap(repo, 'conflict', 'conflicted'));
  assert.equal(repo.read('docs/feature/conflicted/README.md'), undefined);
}))));
// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md#adopt
test('adoption refuses an existing destination before changing the package or Memory declarations', () => Effect.runPromise(Effect.sync(() => useConsumer((repo, root) => {
  createDocument(repo, 'roadmap', { id: 'recovery', title: 'Recovery', body: '# Recovery\n' });
  write(root, 'docs/roadmap/recovery/nested/guide.md', '# Guide\n');
  createDocument(repo, 'memory', { id: 'choice', title: 'Choice', memoryKind: 'decision' });
  const before = repo.read('memory/choice.md');
  mkdirSync(join(root, 'docs/feature/recovered/nested'), { recursive: true });
  throwsCode('DocumentExists', () => adoptRoadmap(repo, 'recovery', 'recovered'));
  assert.equal(repo.read('docs/feature/recovered/README.md'), undefined);
  assert.equal(repo.read('docs/roadmap/recovery/README.md'), '# Recovery\n');
  assert.equal(repo.read('docs/roadmap/recovery/nested/guide.md'), '# Guide\n');
  assert.equal(repo.read('memory/choice.md'), before);
  assert.equal(existsSync(join(repo.privateDir, 'journal.json')), false);
}))));
// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('adopts Roadmap by moving its package and preserving navigation from Memory', () => Effect.runPromise(Effect.sync(() => useConsumer(repo => {
  createDocument(repo, 'roadmap', { id: 'offline', title: 'Offline mode', body: '# Offline mode\n\n## Sync policy\n' });
  createDocument(repo, 'memory', { id: 'prefer-local', title: 'Prefer local state', body: '# Decision\n\n[Plan](../docs/roadmap/offline/README.md#sync-policy)\n', memoryKind: 'decision' });
  adoptRoadmap(repo, 'offline', 'offline-mode');
  const documents = loadDocuments(repo);
  throwsCode('DocumentNotFound', () => findDocument(documents, 'offline', 'roadmap'));
  const feature = findDocument(documents, 'offline-mode', 'feature');
  const memory = findDocument(documents, 'prefer-local', 'memory');
  assert.equal(feature.path, 'docs/feature/offline-mode/README.md');
  assert.match(memory.body, /\]\(\.\.\/docs\/feature\/offline-mode\/README\.md#sync-policy\)/u);
  assert.deepEqual(checkDocuments(repo, documents), []);
  throwsCode('DocumentNotFound', () => adoptRoadmap(repo, 'offline', 'second-feature'));
}))));
// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md
test('supersedes only current same-kind Memory and writes the canonical replacement', () => Effect.runPromise(Effect.sync(() => useConsumer(repo => {
  createDocument(repo, 'feature', { id: 'cache', title: 'Cache', body: '# Cache\n' });
  createDocument(repo, 'memory', { id: 'old-cache', title: 'Old cache choice', body: '# Decision\n', memoryKind: 'decision' });
  createDocument(repo, 'memory', { id: 'new-cache', title: 'New cache choice', body: '# Decision\n', memoryKind: 'decision' });
  createDocument(repo, 'memory', { id: 'cache-note', title: 'Cache note', body: '# Insight\n', memoryKind: 'insight' });
  activateMemory(repo, 'old-cache', 'Confirmed');
  activateMemory(repo, 'new-cache', 'Confirmed');
  linkMemory(repo, 'old-cache', 'docs/feature/cache/README.md');
  supersedeMemory(repo, 'old-cache', 'new-cache', 'Measurements changed');
  const old = findDocument(loadDocuments(repo), 'old-cache', 'memory');
  assert.equal(old.metadata.kind === 'memory' && old.metadata.status, 'superseded');
  assert.equal(old.metadata.kind === 'memory' && old.metadata.supersededBy, 'memory/new-cache.md');
  assert.deepEqual(old.metadata.kind === 'memory' && old.metadata.relations.map(relation => relation.target), ['docs/feature/cache/README.md']);
  assert.doesNotMatch(repo.read(old.path)!, /history:/u);
  throwsCode('DuplicateLink', () => linkMemory(repo, 'old-cache', 'docs/feature/cache/README.md'));
  throwsCode('InvalidMemoryState', () => supersedeMemory(repo, 'new-cache', 'cache-note', 'Wrong kind'));
}))));
// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('rejects frontmatter on Spec support pages and broken declared owners', () => Effect.runPromise(Effect.sync(() => useConsumer((repo, root) => {
  write(root, 'docs/research/ordinary.md', '---\ntitle: Ordinary page\n---\n\n# Notes\n');
  throwsCode('InvalidData', () => loadDocuments(repo));
  write(root, 'docs/research/broken.md', '---\nformat: concord.document/v1\nid: Bad Id\nkind: research\n---\n');
  throwsCode('InvalidData', () => loadDocuments(repo));
}))));

test('Issue closure rejects missing references and duplicate cycles', () => Effect.runPromise(Effect.sync(() => useConsumer((repo, root) => {
  for (const id of ['first-observation', 'second-observation']) createDocument(repo, 'issue', { id, title: id, body: '# Observation\n' });
  const records = loadDocuments(repo);
  for (const [id, target] of [['first-observation', 'second-observation'], ['second-observation', 'first-observation']] as const) {
    const record = findDocument(records, id, 'issue');
    if (record.metadata.kind !== 'issue') throw new Error('Expected Issue');
    write(root, record.path, renderDocument({ ...record.metadata, status: 'closed', closure: { kind: 'duplicate', canonical: `docs/issues/${target}.md` } }, record.body));
  }
  assert.ok(checkDocuments(repo, loadDocuments(repo)).some(finding => finding.code === 'ReferenceCycle'));
  const first = findDocument(records, 'first-observation', 'issue');
  if (first.metadata.kind !== 'issue') throw new Error('Expected Issue');
  write(root, first.path, renderDocument({ ...first.metadata, status: 'closed', closure: { kind: 'fixed', reason: 'historical declaration' } }, first.body));
  assert.ok(checkDocuments(repo, loadDocuments(repo)).some(finding => finding.code === 'FixUnverifiable'));
}))));

// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('all owners keep independent physical names and historical contracts remain outside the graph', () => Effect.runPromise(Effect.sync(() => useConsumer((repo, root) => {
  for (const kind of ['feature', 'roadmap', 'design', 'engineering', 'research'] as const) {
    createDocument(repo, kind, { id: `${kind}-id`, title: kind, ...(kind === 'design' ? { alternatives: ['本地', '远端'] } : {}) });
    renameSync(join(root, `docs/${kind}/${kind}-id`), join(root, `docs/${kind}/中文目录`));
    addPage(repo, kind, '中文目录', '中文专题');
    const page = showPage(repo, kind, '中文目录', '中文专题');
    assert.equal(page.path, `docs/${kind}/中文目录/中文专题.md`);
    setPage(repo, kind, '中文目录', '中文专题', '# 保存\n', page.digest);
    createDocument(repo, kind, { id: `${kind}-id`, title: 'New identity', ...(kind === 'design' ? { alternatives: ['one', 'two'] } : {}) });
  }
  createDocument(repo, 'use-case', { id: 'flow', title: 'Flow', feature: 'docs/feature/中文目录/README.md' });
  assert.equal(findDocument(loadDocuments(repo), 'flow').path, 'docs/feature/中文目录/use-case/flow.md');
  throwsCode('DocumentExists', () => adoptRoadmap(repo, 'roadmap-id', 'feature-id', false));
  createDocument(repo, 'issue', { id: 'issue-id', title: 'Issue' });
  renameSync(join(root, 'docs/issues/issue-id.md'), join(root, 'docs/issues/中文观察.md'));
  createDocument(repo, 'memory', { id: 'note-id', title: 'Note', memoryKind: 'note' });
  renameSync(join(root, 'memory/note-id.md'), join(root, 'memory/中文记忆.md'));
  assert.equal(findDocument(loadDocuments(repo), '中文观察').path, 'docs/issues/中文观察.md');
  assert.equal(findDocument(loadDocuments(repo), '中文记忆').path, 'memory/中文记忆.md');
  const historical = readFileSync(join(root, 'docs/design/中文目录/README.md'), 'utf8');
  write(root, 'memory/design/README.md', historical);
  write(root, 'memory/design/原始材料.md', '# 历史材料\n');
  assert.deepEqual(checkDocuments(repo, loadDocuments(repo)), []);
  assert.equal(loadDocuments(repo).some(record => record.path === 'memory/design/README.md'), false);
  const view = inspectDocuments(repo);
  assert.equal(view.documents.some(record => record.path === 'memory/design/README.md'), false);
  const page = view.pages.find(item => item.path === 'memory/design/README.md');
  assert.equal(page?.body, historical);
  throwsCode('ReferenceNotFound', () => resolveReference(repo, loadDocuments(repo), 'memory/design/README.md'));
  write(root, 'memory/design/README.md', historical.replace('kind: design', 'kind: unknown'));
  assert.equal(loadDocuments(repo).some(record => record.path === 'memory/design/README.md'), false);
}))));

// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('Use Case identity follows its filename and nested Markdown stays a supporting page', () => Effect.runPromise(Effect.sync(() => useConsumer((repo, root) => {
  createDocument(repo, 'feature', { id: 'sample', title: 'Sample' });
  createDocument(repo, 'use-case', { id: 'internal-id', title: '独立名称', feature: 'sample' });
  const original = findDocument(loadDocuments(repo), 'internal-id', 'use-case');
  const namedPath = 'docs/feature/sample/use-case/中文名称.md';
  renameSync(join(root, original.path), join(root, namedPath));
  assert.equal(resolveReference(repo, loadDocuments(repo), namedPath).metadata.id, '中文名称');
  write(root, original.path, renderDocument(original.metadata, original.body));
  assert.deepEqual(checkDocuments(repo, loadDocuments(repo)), []);
  write(root, 'docs/feature/sample/use-case/nested/support.md', '# Supporting material\n');
  assert.equal(resolveReference(repo, loadDocuments(repo), 'docs/feature/sample/use-case/nested/support.md').path, 'docs/feature/sample/README.md');
  write(root, 'docs/feature/sample/use-case/带 空格.md', '# Invalid name\n');
  throwsCode('InvalidData', () => loadDocuments(repo));
}))));

// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('Unicode document names retain identity through pages, references, adoption and Design decisions', () => Effect.runPromise(Effect.sync(() => useConsumer((repo, root) => {
  createDocument(repo, 'feature', { id: '角色NPC', title: '角色' });
  createDocument(repo, 'use-case', { id: '扩展NPC动作', title: '扩展 NPC 动作', feature: '角色NPC' });
  addPage(repo, 'feature', '角色NPC', '认知与执行');
  const topic = showPage(repo, 'feature', '角色NPC', '认知与执行');
  setPage(repo, 'feature', '角色NPC', '认知与执行', '# 认知与执行\n\n## 动作\n', topic.digest);
  const documents = loadDocuments(repo);
  assert.equal(findDocument(documents, '扩展NPC动作').path, 'docs/feature/角色NPC/use-case/扩展NPC动作.md');
  assert.equal(resolveReference(repo, documents, 'docs/feature/角色NPC/认知与执行.md#动作').metadata.id, '角色NPC');
  throwsCode('DocumentExists', () => createDocument(repo, 'feature', { id: '角色NPC', title: '重复' }));
  throwsCode('PreimageChanged', () => setPage(repo, 'feature', '角色NPC', '认知与执行', '# stale\n', topic.digest));
  for (const id of ['δοκιμή', 'नमस्ते', 'cafe\u0301', '日本語-１２３']) {
    createDocument(repo, 'engineering', { id, title: id });
    assert.equal(findDocument(loadDocuments(repo), id).metadata.id, id);
  }
  createDocument(repo, 'roadmap', { id: '地图规划', title: '地图规划' });
  addPage(repo, 'roadmap', '地图规划', '地形');
  adoptRoadmap(repo, '地图规划', '地图', false);
  assert.equal(showPage(repo, 'feature', '地图', '地形').path, 'docs/feature/地图/地形.md');
  createDocument(repo, 'design', { id: '存储方案', title: '存储', alternatives: ['本地', '远端'] });
  authorDesignFixture(root, '存储方案', ['本地', '远端'], '本地');
  const selectedPath = join(root, 'docs/design/存储方案/DECISION.md');
  writeFileSync(selectedPath, readFileSync(selectedPath, 'utf8').replace(/^Selected:.*\n/mu, ''));
  decideDesign(repo, '存储方案', '本地', [], '本地读取');
  const design = findDocument(loadDocuments(repo), '存储方案');
  assert.ok(design.metadata.kind === 'design' && design.metadata.decision?.selected === '本地');
  for (const name of ['../越界', '目录/子项', '目录\\子项', 'a#段落', 'a?b', '%2f', '带 空格', 'a\n', 'a\u202eb', 'a\0b', '-中文', '中文--名', '\u0301']) {
    throwsCode('InvalidData', () => createDocument(repo, 'feature', { id: name, title: 'Invalid' }));
    throwsCode('InvalidPage', () => addPage(repo, 'feature', '角色NPC', name));
  }
}))));
