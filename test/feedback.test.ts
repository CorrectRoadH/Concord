import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { Effect } from 'effect';
import { getWorkspaceSnapshot } from '../dist/application.js';
import { cacheStatus, scanAnnotations, clearCache } from '../dist/annotations.js';
import { checkDocuments, closeIssue, createDocument, linkFeedbackFeature, loadDocuments, renderDocument, setAuthor, setDocumentMetadata } from '../dist/documents.js';
import { mergeFeedbackCache, readFeedbackCache } from '../dist/feedback-cache.js';
import { listFeedback, syncFeedback } from '../dist/feedback.js';
import type { RemoteFeedback } from '../dist/feedback-schema.js';
import type { FeedbackTransport } from '../dist/feedback-providers.js';
import { setConfig, showConfig } from '../dist/editing.js';
import { ConcordError } from '../dist/shared.js';
import { initialize, LocalRepository } from '../dist/storage.js';
import { humanOutput } from '../dist/presentation.js';

const issue = (overrides: Record<string, unknown> = {}) => ({
  id: 9001,
  number: 7,
  html_url: 'https://github.com/acme/project/issues/7',
  title: 'Remote report',
  body: null,
  state: 'open',
  updated_at: '2026-09-14T00:00:00.100Z',
  ...overrides,
});

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'concord-feedback-'));
  execFileSync('git', ['init', '-q', root]);
  const initial = new LocalRepository(root, { initialize: true });
  try { initialize(initial); } finally { initial.close(); }
  const repo = new LocalRepository(root);
  try {
    const current = showConfig(repo);
    setConfig(repo, { ...current.config, feedbackConnections: [{ id: 'github-main', provider: 'github', credentialEnv: 'TEST_GITHUB_TOKEN', owner: 'acme', repo: 'project' }] }, current.digest);
  } finally { repo.close(); }
  return root;
}

function githubTransport(items: readonly unknown[], options: { readonly wait?: Promise<void>; readonly reached?: () => void; readonly failList?: boolean } = {}): FeedbackTransport {
  return request => {
    if (request.url === 'https://api.github.com/repos/acme/project') return Effect.succeed({ status: 200, headers: {}, body: { id: 42 } });
    if (request.url.includes('/issues?')) {
      options.reached?.();
      if (options.failList) return Effect.fail(new ConcordError('InjectedFailure', 'list failed'));
      return Effect.promise(async () => { await options.wait; return { status: 200, headers: {}, body: items }; });
    }
    return Effect.fail(new ConcordError('UnexpectedRequest', request.url));
  };
}

function open<A>(root: string, use: (repo: LocalRepository) => A): A {
  const repo = new LocalRepository(root);
  try { return use(repo); } finally { repo.close(); }
}

function errorCode(error: unknown, code: string): boolean {
  return error instanceof ConcordError && error.code === code;
}

// @concord-case feedback-workspace-readonly-cache
// @concord-contract docs/feature/feedback/use-case/triage-feedback.md
test('feedback workspace stays tolerant and readonly when its cache table or unrelated owners are unavailable', async () => {
  const root = fixture();
  const uninitialized = mkdtempSync(join(tmpdir(), 'concord-feedback-uninitialized-'));
  try {
    execFileSync('git', ['init', '-q', uninitialized]);
    assert.deepEqual((await Effect.runPromise(getWorkspaceSnapshot(uninitialized))).feedback, []);
    open(root, repo => createDocument(repo, 'issue', { id: 'local-note', title: 'Local note' }));
    mkdirSync(join(root, 'memory'), { recursive: true });
    writeFileSync(join(root, 'memory', 'broken.md'), '---\nformat: concord.document/v1\nid: broken\n---\n');
    const cache = join(root, '.git', 'concord', 'cache.sqlite');
    assert.equal(existsSync(cache), false);
    const workspace = await Effect.runPromise(getWorkspaceSnapshot(root));
    assert.deepEqual(workspace.feedback.map(item => item.document.metadata.id), ['local-note']);
    assert.equal(existsSync(cache), false, 'workspace polling must not create a feedback cache');
    rmSync(join(root, 'memory', 'broken.md'));

    open(root, repo => scanAnnotations(repo, { cache: 'rebuild' }));
    const before = statSync(cache).mtimeMs;
    open(root, repo => assert.deepEqual(listFeedback(repo).map(item => item.document.metadata.id), ['local-note']));
    assert.equal(statSync(cache).mtimeMs, before, 'reading a database without feedback_cache must stay readonly');
    const database = new DatabaseSync(cache, { readOnly: true });
    try { assert.equal(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='feedback_cache'").get(), undefined); }
    finally { database.close(); }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(uninitialized, { recursive: true, force: true });
  }
});

// @concord-case feedback-sync-preserves-local-owner
// @concord-contract docs/feature/feedback/use-case/triage-feedback.md
test('sync binds and imports atomically while repeat sync preserves editable local state and first source snapshot', async () => {
  const root = fixture();
  try {
    const first = await Effect.runPromise(syncFeedback(root, 'github-main', { transport: githubTransport([issue()]), credential: 'test-token' }));
    assert.equal(first.imported, 1);
    assert.deepEqual([...first.changedPaths].sort(), ['concord.json', 'docs/issues/feedback-github-9001.md']);
    open(root, repo => {
      const config = showConfig(repo).config.feedbackConnections?.[0];
      assert.equal(config?.provider === 'github' ? config.repositoryId : undefined, '42');
      assert.match(cacheStatus(repo).detail ?? '', /feedback_cache/u);
      const document = loadDocuments(repo).find(item => item.metadata.id === 'feedback-github-9001')!;
      assert.equal(document.metadata.kind === 'issue' ? document.metadata.source?.body : undefined, '');
      setDocumentMetadata(repo, document.path, { title: 'Local title' }, document.digest);
      const edited = loadDocuments(repo).find(item => item.metadata.id === 'feedback-github-9001')!;
      setAuthor(repo, edited.path, '# Local investigation\n', edited.digest);
    });
    const second = await Effect.runPromise(syncFeedback(root, 'github-main', {
      transport: githubTransport([issue({ title: 'Changed remote title', body: 'Remote rewrite', state: 'closed', updated_at: '2026-09-14T01:00:00Z' })]),
      credential: 'test-token',
    }));
    assert.equal(second.imported, 0);
    open(root, repo => {
      const item = listFeedback(repo)[0]!;
      assert.equal(item.document.metadata.title, 'Local title');
      assert.equal(item.document.body, '# Local investigation\n');
      assert.equal(item.document.metadata.source?.title, 'Remote report');
      assert.equal(item.document.metadata.state, 'draft');
      assert.equal(item.remote?.title, 'Changed remote title');
      assert.equal(item.triage, 'pending');
      createDocument(repo, 'feature', { id: 'feedback-home', title: 'Feedback home' });
      linkFeedbackFeature(repo, item.document.metadata.id, 'feedback-home');
      assert.equal(listFeedback(repo)[0]?.triage, 'linked');
      closeIssue(repo, item.document.metadata.id, 'Triaged');
      clearCache(repo);
      const uncached = listFeedback(repo)[0]!;
      assert.equal(uncached.availability, 'unavailable');
      assert.equal(uncached.remote, null);
    });
    const afterClear = await Effect.runPromise(syncFeedback(root, 'github-main', { transport: githubTransport([issue({ state: 'open', updated_at: '2026-09-14T02:00:00Z' })]), credential: 'test-token' }));
    assert.equal(afterClear.imported, 0, 'cache clear must not erase durable source identity');
    open(root, repo => {
      assert.equal(listFeedback(repo)[0]?.document.metadata.state, 'closed', 'remote open state must not reopen local feedback');
      const current = showConfig(repo);
      setConfig(repo, { ...current.config, feedbackConnections: [...(current.config.feedbackConnections ?? []), { id: 'github-copy', provider: 'github', credentialEnv: 'TEST_GITHUB_TOKEN', owner: 'acme', repo: 'project' }] }, current.digest);
    });
    const otherConnection = await Effect.runPromise(syncFeedback(root, 'github-copy', { transport: githubTransport([issue({ updated_at: '2026-09-14T03:00:00Z' })]), credential: 'test-token' }));
    assert.equal(otherConnection.imported, 0);
    open(root, repo => assert.equal(listFeedback(repo).length, 1, 'the same remote identity across connections remains one local owner'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @concord-case feedback-dry-run-and-config-cas
// @concord-contract docs/feature/feedback/use-case/triage-feedback.md
test('dry-run and failed or stale fetches write neither documents nor cache', async () => {
  const root = fixture();
  try {
    const before = readFileSync(join(root, 'concord.json'), 'utf8');
    const dry = await Effect.runPromise(syncFeedback(root, 'github-main', { dryRun: true, transport: githubTransport([issue()]), credential: 'test-token' }));
    assert.equal(dry.imported, 1);
    assert.equal(readFileSync(join(root, 'concord.json'), 'utf8'), before);
    assert.equal(existsSync(join(root, 'docs/issues/feedback-github-9001.md')), false);
    assert.equal(existsSync(join(root, '.git/concord/cache.sqlite')), false);

    await assert.rejects(Effect.runPromise(syncFeedback(root, 'github-main', { transport: githubTransport([], { failList: true }), credential: 'test-token' })), error => errorCode(error, 'InjectedFailure'));
    assert.equal(readFileSync(join(root, 'concord.json'), 'utf8'), before);

    let reached!: () => void, release!: () => void;
    const atList = new Promise<void>(resolve => { reached = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    const running = Effect.runPromise(syncFeedback(root, 'github-main', { transport: githubTransport([issue()], { wait, reached }), credential: 'test-token' }));
    await atList;
    open(root, repo => {
      const current = showConfig(repo);
      setConfig(repo, { ...current.config, sourceRoots: ['src'] }, current.digest);
    });
    release();
    await assert.rejects(running, error => errorCode(error, 'PreimageChanged'));
    assert.equal(existsSync(join(root, 'docs/issues/feedback-github-9001.md')), false);
    assert.equal(existsSync(join(root, '.git/concord/cache.sqlite')), false);

    writeFileSync(join(root, '.git/concord/cache.sqlite'), 'not a sqlite database');
    const cacheFailed = await Effect.runPromise(syncFeedback(root, 'github-main', { transport: githubTransport([issue()]), credential: 'test-token' }));
    assert.equal(cacheFailed.imported, 1);
    assert.ok(cacheFailed.warnings.some(warning => warning.includes('cache could not be updated')));
    assert.match(humanOutput(cacheFailed), /Fetched: 1; imported: 1/u);
    assert.match(humanOutput(cacheFailed), /Warnings:/u);
    const retried = await Effect.runPromise(syncFeedback(root, 'github-main', { transport: githubTransport([issue()]), credential: 'test-token' }));
    assert.equal(retried.imported, 0);
    assert.ok(retried.warnings.some(warning => warning.includes('cache could not be updated')));
    open(root, repo => assert.equal(loadDocuments(repo).filter(document => document.metadata.kind === 'issue' && document.metadata.source !== undefined).length, 1));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @concord-case feedback-cache-version-and-identity
// @concord-contract docs/feature/feedback/use-case/triage-feedback.md
test('cache compares real instants, rejects unsafe paths, and duplicate source identities are findings plus sync failures', async () => {
  const root = fixture();
  try {
    await Effect.runPromise(syncFeedback(root, 'github-main', { transport: githubTransport([issue()]), credential: 'test-token' }));
    open(root, repo => {
      const stale: RemoteFeedback = { provider: 'github', instance: 'https://api.github.com', id: '9001', url: 'https://github.com/acme/project/issues/7', title: 'Stale', body: '', state: 'open', updatedAt: '2026-09-14T00:00:00Z' };
      mergeFeedbackCache(repo, 'github-main', [stale]);
      assert.equal(readFeedbackCache(repo).items.values().next().value?.remote.title, 'Remote report');
      const original = loadDocuments(repo).find(item => item.metadata.id === 'feedback-github-9001')!;
      const duplicate = { ...original.metadata, id: 'duplicate-feedback' };
      writeFileSync(join(root, 'docs/issues/duplicate-feedback.md'), renderDocument(duplicate, original.body));
      assert.ok(checkDocuments(repo, loadDocuments(repo)).some(finding => finding.code === 'DuplicateFeedbackSource'));
    });
    await assert.rejects(Effect.runPromise(syncFeedback(root, 'github-main', { transport: githubTransport([issue()]), credential: 'test-token' })), error => errorCode(error, 'FeedbackIdentityConflict'));
    rmSync(join(root, 'docs/issues/duplicate-feedback.md'));
    open(root, repo => clearCache(repo));
    const dangling = join(root, '.git/concord/cache.sqlite');
    symlinkSync(join(root, 'missing-cache-target'), dangling);
    open(root, repo => assert.throws(() => readFeedbackCache(repo), error => errorCode(error, 'UnsafePath')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
