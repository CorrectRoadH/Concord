import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import {
  adoptRoadmap,
  addPage,
  checkDocuments,
  closeIssue,
  createDocument,
  decideDesign,
  findDocument,
  linkIssue,
  loadDocuments,
  promoteMemory,
  reopenMemory,
  resolveMemory,
  resolveReference,
  retirePromotion,
  setAuthor,
  setPage,
  showPage,
  supersedeMemory,
} from '../dist/documents.js';
import { LocalRepository, initialize } from '../dist/storage.js';

function createConsumer() {
  const root = mkdtempSync(join(tmpdir(), 'concord-documents-'));
  execFileSync('git', ['init', '-q', root]);
  const initial = new LocalRepository(root, { initialize: true });
  try { initialize(initial); } finally { initial.close(); }
  return root;
}

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

// @concord-case documents-resolve-owner-pages
// @concord-contract docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
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

// @concord-case documents-reject-duplicate-owner-id
// @concord-contract docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('rejects a duplicate same-kind id before creating a second Use Case', () => Effect.runPromise(Effect.sync(() => useConsumer(repo => {
  createDocument(repo, 'feature', { id: 'accounts', title: 'Accounts', body: '# Accounts\n' });
  createDocument(repo, 'feature', { id: 'sessions', title: 'Sessions', body: '# Sessions\n' });
  createDocument(repo, 'use-case', { id: 'sign-in', title: 'Account sign in', body: '# Sign in\n', feature: 'accounts' });
  throwsCode('DocumentExists', () => createDocument(repo, 'use-case', { id: 'sign-in', title: 'Session sign in', body: '# Sign in\n', feature: 'sessions' }));
  const documents = loadDocuments(repo);
  assert.equal(documents.filter(document => document.metadata.kind === 'use-case' && document.metadata.id === 'sign-in').length, 1);
  assert.equal(repo.read('docs/feature/sessions/use-case/sign-in.md'), undefined);
  assert.deepEqual(checkDocuments(repo, documents), []);
}))));

// @concord-case documents-decide-design-once
// @concord-contract docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('decides a design once and validates dry-run without writing', () => Effect.runPromise(Effect.sync(() => useConsumer(repo => {
  createDocument(repo, 'feature', { id: 'search', title: 'Search', body: '# Search\n' });
  createDocument(repo, 'design', { id: 'search-index', title: 'Search index', body: '# Options\n', alternatives: ['sqlite', 'memory'] });
  const receipt = decideDesign(repo, 'search-index', 'sqlite', ['docs/feature/search/README.md'], 'Keeps local state rebuildable');
  assert.equal(receipt.operation, 'decide-design');
  let design = findDocument(loadDocuments(repo), 'search-index', 'design');
  assert.equal(design.metadata.kind === 'design' && design.metadata.decision?.selected, 'sqlite');
  throwsCode('DecisionExists', () => decideDesign(repo, 'search-index', 'memory', [], 'Changed mind'));

  const dry = createDocument(repo, 'research', { id: 'dry-study', title: 'Dry study', body: '# Dry\n', observedAt: '2026-09-13', dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.equal(loadDocuments(repo).some(document => document.metadata.id === 'dry-study'), false);
}))));

// @concord-case documents-protect-page-preimages
// @concord-contract docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('creates template packages and protects supporting page preimages', () => Effect.runPromise(Effect.sync(() => useConsumer(repo => {
  const minimal = createDocument(repo, 'feature', { id: 'empty-selection', title: 'Empty selection', pages: [] });
  assert.deepEqual(minimal.changedPaths, ['docs/feature/empty-selection/README.md']);
  createDocument(repo, 'engineering', { id: 'ci', title: 'CI' });
  createDocument(repo, 'design', { id: 'cache', title: 'Cache', alternatives: ['sqlite', 'files'], pages: ['architecture'] });
  assert.ok(repo.read('docs/engineering/ci/README.md')?.includes('# CI'));
  assert.ok(repo.read('docs/design/cache/GOALS.md'));
  assert.ok(repo.read('docs/design/cache/plans/sqlite/architecture.md'));
  assert.ok(repo.read('docs/design/cache/plans/files/architecture.md'));
  rmSync(repo.absolute('docs/design/cache/plans/sqlite/README.md'));
  addPage(repo, 'design', 'cache', 'readme', false, 'sqlite');
  assert.doesNotMatch(repo.read('docs/design/cache/plans/sqlite/README.md')!, /\]\(/);
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

// @concord-case documents-select-memory-template
// @concord-contract docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('uses the memoryKind template when body is omitted', () => Effect.runPromise(Effect.sync(() => useConsumer(repo => {
  createDocument(repo, 'memory', { id: 'stale', title: 'Stale cache', memoryKind: 'problem' });
  assert.match(findDocument(loadDocuments(repo), 'stale', 'memory').body, /## Observation/u);
}))));

// @concord-case adoption-rejects-unsafe-package
// @concord-contract docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
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
  throwsCode('NestedOwner', () => adoptRoadmap(repo, 'nested', 'nested-feature'));
  assert.equal(repo.read('docs/feature/nested-feature/README.md'), undefined);
  createDocument(repo, 'roadmap', { id: 'linked', title: 'Linked', body: '# L\n' });
  symlinkSync('../../other', join(root, 'docs/roadmap/linked/link'));
  throwsCode('UnsafePath', () => adoptRoadmap(repo, 'linked', 'linked-feature'));
  assert.equal(repo.read('docs/feature/linked-feature/README.md'), undefined);
}))));

// @concord-case adoption-detects-source-set-drift
// @concord-contract docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
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

// @concord-case adoption-detects-byte-and-destination-drift
// @concord-contract docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
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

// @concord-case adoption-recovers-complete-package
// @concord-contract docs/feature/local-sdlc/use-case/recover-local-state.md
test('interrupted adoption recovers the complete old package and preserves unknown edits', () => Effect.runPromise(Effect.sync(() => useConsumer((repo, root) => {
  createDocument(repo, 'roadmap', { id: 'recovery', title: 'Recovery', body: '# Recovery\n' });
  write(root, 'docs/roadmap/recovery/nested/guide.md', '# Guide\n');
  createDocument(repo, 'memory', { id: 'choice', title: 'Choice', memoryKind: 'decision' });
  promoteMemory(repo, 'choice', 'docs/roadmap/recovery/README.md');
  const blocked = join(root, 'docs/feature/recovered/nested');
  mkdirSync(blocked, { recursive: true }); chmodSync(blocked, 0o555);
  try { throwsCode('RecoveryRequired', () => adoptRoadmap(repo, 'recovery', 'recovered')); }
  finally { chmodSync(blocked, 0o755); }
  const planned = repo.read('docs/feature/recovered/README.md');
  assert.ok(planned); repo.close();
  const recovery = new LocalRepository(root, { recover: true });
  try {
    write(root, 'docs/feature/recovered/README.md', '# External edit\n');
    throwsCode('RecoveryConflict', () => recovery.recover());
    assert.equal(recovery.read('docs/feature/recovered/README.md'), '# External edit\n');
    write(root, 'docs/feature/recovered/README.md', planned);
    assert.equal(recovery.recover().status, 'rolled-back');
    assert.equal(recovery.read('docs/feature/recovered/README.md'), undefined);
    const recoveredRoadmap = findDocument(loadDocuments(recovery), 'recovery', 'roadmap');
    assert.equal(recoveredRoadmap.metadata.kind === 'roadmap' && recoveredRoadmap.metadata.state, 'planned');
    const recoveredMemory = findDocument(loadDocuments(recovery), 'choice', 'memory');
    assert.deepEqual(recoveredMemory.metadata.kind === 'memory' && recoveredMemory.metadata.promotions, ['docs/roadmap/recovery/README.md']);
    assert.equal(recovery.read('docs/roadmap/recovery/nested/guide.md'), '# Guide\n');
  } finally { recovery.close(); }
}))));

// @concord-case adoption-migrates-promotions
// @concord-contract docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('adopts Roadmap atomically and migrates current promotions to the Feature', () => Effect.runPromise(Effect.sync(() => useConsumer(repo => {
  createDocument(repo, 'roadmap', { id: 'offline', title: 'Offline mode', body: '# Offline mode\n\n## Sync policy\n' });
  createDocument(repo, 'memory', { id: 'prefer-local', title: 'Prefer local state', body: '# Decision\n', memoryKind: 'decision' });
  promoteMemory(repo, 'prefer-local', 'docs/roadmap/offline/README.md#sync-policy');
  adoptRoadmap(repo, 'offline', 'offline-mode');

  const documents = loadDocuments(repo);
  const roadmap = findDocument(documents, 'offline', 'roadmap');
  const feature = findDocument(documents, 'offline-mode', 'feature');
  const memory = findDocument(documents, 'prefer-local', 'memory');
  assert.equal(roadmap.metadata.kind === 'roadmap' && roadmap.metadata.state, 'adopted');
  assert.equal(feature.metadata.kind === 'feature' && feature.metadata.origin, roadmap.path);
  assert.deepEqual(memory.metadata.kind === 'memory' && memory.metadata.promotions, ['docs/feature/offline-mode/README.md#sync-policy']);
  assert.equal(memory.metadata.kind === 'memory' && memory.metadata.history.at(-1)?.action, 'adopt-roadmap');
  assert.deepEqual(checkDocuments(repo, documents), []);
  throwsCode('InvalidRoadmapState', () => adoptRoadmap(repo, 'offline', 'second-feature'));
}))));

// @concord-case memory-enforces-problem-epochs
// @concord-contract docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md
test('enforces Problem epochs and preserves resolution history across reopen', () => Effect.runPromise(Effect.sync(() => useConsumer(repo => {
  createDocument(repo, 'memory', { id: 'token-race', title: 'Token race', body: '# Problem\n', memoryKind: 'problem' });
  throwsCode('InvalidProof', () => resolveMemory(repo, 'token-race', 'fixed', 'Fixed lock ordering', { red: 'red-1', green: 'green-1', selectedCaseId: 'token-case', epoch: 1 }));
  resolveMemory(repo, 'token-race', 'fixed', 'Fixed lock ordering', { red: 'red-1', green: 'green-1', selectedCaseId: 'token-case', epoch: 0 });
  let problem = findDocument(loadDocuments(repo), 'token-race', 'memory');
  assert.equal(problem.metadata.kind === 'memory' && problem.metadata.resolution?.evidenceLevel, 'command');
  reopenMemory(repo, 'token-race', 'Regression returned');
  problem = findDocument(loadDocuments(repo), 'token-race', 'memory');
  assert.equal(problem.metadata.kind === 'memory' && problem.metadata.epoch, 1);
  assert.equal(problem.metadata.kind === 'memory' && problem.metadata.resolution, undefined);
  assert.equal(problem.metadata.kind === 'memory' && problem.metadata.history.at(-1)?.resolution?.red, 'red-1');
  resolveMemory(repo, 'token-race', 'not-a-bug', 'Expected upstream behavior');
  problem = findDocument(loadDocuments(repo), 'token-race', 'memory');
  assert.equal(problem.metadata.kind === 'memory' && problem.metadata.resolution?.evidenceLevel, 'author');
  assert.equal(problem.metadata.kind === 'memory' && problem.metadata.resolution?.epoch, 1);
}))));

// @concord-case memory-supersedes-same-kind
// @concord-contract docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md
test('supersedes only current same-kind Memory and retires its promotions into history', () => Effect.runPromise(Effect.sync(() => useConsumer(repo => {
  createDocument(repo, 'feature', { id: 'cache', title: 'Cache', body: '# Cache\n' });
  createDocument(repo, 'memory', { id: 'old-cache', title: 'Old cache choice', body: '# Decision\n', memoryKind: 'decision' });
  createDocument(repo, 'memory', { id: 'new-cache', title: 'New cache choice', body: '# Decision\n', memoryKind: 'decision' });
  createDocument(repo, 'memory', { id: 'cache-note', title: 'Cache note', body: '# Insight\n', memoryKind: 'insight' });
  promoteMemory(repo, 'old-cache', 'docs/feature/cache/README.md');
  supersedeMemory(repo, 'old-cache', 'new-cache', 'Measurements changed');
  const old = findDocument(loadDocuments(repo), 'old-cache', 'memory');
  assert.equal(old.metadata.kind === 'memory' && old.metadata.state, 'superseded');
  assert.equal(old.metadata.kind === 'memory' && old.metadata.supersededBy, 'memory/new-cache.md');
  assert.deepEqual(old.metadata.kind === 'memory' && old.metadata.promotions, []);
  assert.ok(old.metadata.kind === 'memory' && old.metadata.history.some(entry => entry.action === 'retire-promotion'));
  throwsCode('InvalidMemoryState', () => promoteMemory(repo, 'old-cache', 'docs/feature/cache/README.md'));
  throwsCode('InvalidMemoryState', () => supersedeMemory(repo, 'new-cache', 'cache-note', 'Wrong kind'));
}))));

// @concord-case memory-and-issue-state-guards
// @concord-contract docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md
test('retires an exact promotion and refuses to close an Issue linked to an open Problem', () => Effect.runPromise(Effect.sync(() => useConsumer(repo => {
  createDocument(repo, 'feature', { id: 'checkout', title: 'Checkout', body: '# Checkout\n' });
  createDocument(repo, 'memory', { id: 'checkout-fails', title: 'Checkout fails', body: '# Problem\n', memoryKind: 'problem' });
  createDocument(repo, 'issue', { id: 'checkout-report', title: 'Checkout report', body: '# Observation\n' });
  promoteMemory(repo, 'checkout-fails', 'docs/feature/checkout/README.md');
  throwsCode('PromotionNotFound', () => retirePromotion(repo, 'checkout-fails', 'docs/feature/checkout/README.md#other', 'Wrong target'));
  retirePromotion(repo, 'checkout-fails', 'docs/feature/checkout/README.md', 'No longer current');
  linkIssue(repo, 'checkout-report', 'memory/checkout-fails.md');
  throwsCode('OpenProblem', () => closeIssue(repo, 'checkout-report', 'Handled'));
  resolveMemory(repo, 'checkout-fails', 'external-fixed', 'Upstream released a correction');
  closeIssue(repo, 'checkout-report', 'The linked Problem is resolved');
  let documents = loadDocuments(repo);
  const issue = findDocument(documents, 'checkout-report', 'issue');
  assert.equal(issue.metadata.kind === 'issue' && issue.metadata.state, 'closed');
  assert.equal(issue.metadata.kind === 'issue' && issue.metadata.history.at(-1)?.action, 'close');
  reopenMemory(repo, 'checkout-fails', 'A later regression reopened the engineering Problem');
  documents = loadDocuments(repo);
  const reopenedIssue = findDocument(documents, 'checkout-report', 'issue');
  assert.equal(reopenedIssue.metadata.kind === 'issue' && reopenedIssue.metadata.state, 'closed');
  const reopenedProblem = findDocument(documents, 'checkout-fails', 'memory');
  assert.equal(reopenedProblem.metadata.kind === 'memory' && reopenedProblem.metadata.state, 'open');
  assert.deepEqual(checkDocuments(repo, documents), []);
}))));

// @concord-case documents-distinguish-managed-frontmatter
// @concord-contract docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('ignores ordinary Markdown frontmatter but rejects a broken declared Concord owner', () => Effect.runPromise(Effect.sync(() => useConsumer((repo, root) => {
  write(root, 'docs/research/ordinary.md', '---\ntitle: Ordinary page\n---\n\n# Notes\n');
  assert.deepEqual(loadDocuments(repo), []);
  write(root, 'docs/research/broken.md', '---\nformat: concord.document/v1\nid: Bad Id\nkind: research\n---\n');
  throwsCode('InvalidData', () => loadDocuments(repo));
}))));
