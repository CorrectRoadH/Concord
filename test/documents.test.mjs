import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  adoptRoadmap,
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

function useConsumer(run) {
  const root = createConsumer();
  const repo = new LocalRepository(root);
  try { return run(repo, root); }
  finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
}

function write(root, path, contents) {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
}

function throwsCode(code, operation) {
  assert.throws(operation, error => error?.code === code);
}

test('creates strict owners, resolves feature supporting pages, and only replaces author prose', () => useConsumer((repo, root) => {
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
}));

test('rejects a duplicate same-kind id before creating a second Use Case', () => useConsumer(repo => {
  createDocument(repo, 'feature', { id: 'accounts', title: 'Accounts', body: '# Accounts\n' });
  createDocument(repo, 'feature', { id: 'sessions', title: 'Sessions', body: '# Sessions\n' });
  createDocument(repo, 'use-case', { id: 'sign-in', title: 'Account sign in', body: '# Sign in\n', feature: 'accounts' });
  throwsCode('DocumentExists', () => createDocument(repo, 'use-case', { id: 'sign-in', title: 'Session sign in', body: '# Sign in\n', feature: 'sessions' }));
  const documents = loadDocuments(repo);
  assert.equal(documents.filter(document => document.metadata.kind === 'use-case' && document.metadata.id === 'sign-in').length, 1);
  assert.equal(repo.read('docs/feature/sessions/use-case/sign-in.md'), undefined);
  assert.deepEqual(checkDocuments(repo, documents), []);
}));

test('decides a design once and validates dry-run without writing', () => useConsumer(repo => {
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
}));

test('adopts Roadmap atomically and migrates current promotions to the Feature', () => useConsumer(repo => {
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
}));

test('enforces Problem epochs and preserves resolution history across reopen', () => useConsumer(repo => {
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
}));

test('supersedes only current same-kind Memory and retires its promotions into history', () => useConsumer(repo => {
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
}));

test('retires an exact promotion and refuses to close an Issue linked to an open Problem', () => useConsumer(repo => {
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
  assert.equal(findDocument(documents, 'checkout-report', 'issue').metadata.kind === 'issue' && findDocument(documents, 'checkout-report', 'issue').metadata.state, 'closed');
  assert.equal(findDocument(documents, 'checkout-fails', 'memory').metadata.kind === 'memory' && findDocument(documents, 'checkout-fails', 'memory').metadata.state, 'open');
  assert.deepEqual(checkDocuments(repo, documents), []);
}));

test('ignores ordinary Markdown frontmatter but rejects a broken declared Concord owner', () => useConsumer((repo, root) => {
  write(root, 'docs/research/ordinary.md', '---\ntitle: Ordinary page\n---\n\n# Notes\n');
  assert.deepEqual(loadDocuments(repo), []);
  write(root, 'docs/research/broken.md', '---\nformat: concord.document/v1\nid: Bad Id\nkind: research\n---\n');
  throwsCode('InvalidData', () => loadDocuments(repo));
}));
