import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { createDocument, initialize } from '../support/operations.ts';
import { runApplication } from '../support/repository.ts';
import { createConsumer } from '../support/consumer.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { getViewFile, getWorkspaceSnapshot } from "../../src/app/index.ts";
import { cacheStatus, scanAnnotations, clearCache } from "../../src/domain/tests/index.ts";
import { checkDocuments, loadDocuments, setAuthor } from "../../src/domain/documents/index.ts";

import { linkIssue, closeIssue } from "../../src/domain/issues/index.ts";
import { renderDocument } from "../../src/model/index.ts";
import { mergeFeedbackCache, readFeedbackCache, PersistentCache } from "../../src/base/cache/index.ts";
import { openHawdb } from "../../src/base/cache/index.ts";
import { listFeedback, syncFeedback } from "../../src/domain/feedback/index.ts";
import { type RemoteFeedback } from "../../src/model/index.ts";
import { type FeedbackTransport } from "../../src/domain/feedback/index.ts";
import { setConfig, showConfig } from "../../src/app/index.ts";
import { ConcordError } from "../../src/model/index.ts";
import { LocalRepository } from "../support/repository.ts";

import { humanOutput } from "../../src/entry/cli/index.ts";
import { projectConfigPath } from '../support/support.ts';

const nativeRuntime = makeRuntimeEnvironment(process.cwd(), process.env);

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

function fixture(existingCache = true): string {
  const root = createConsumer();
  const repo = new LocalRepository(root);
  try {
    const current = showConfig(repo);
    setConfig(repo, { ...current.config, feedbackConnections: [{ id: 'github-main', provider: 'github', credentialEnv: 'TEST_GITHUB_TOKEN', owner: 'acme', repo: 'project' }] }, current.digest);
    if (existingCache) PersistentCache.repository(repo).prepareWrite({ create: true });
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

// @use-case docs/feature/feedback/use-case/triage-feedback.md
test('directed feedback reads recover from a brief cache writer and keep source bodies when it stays busy', async () => {
  const root = fixture();
  const remote: RemoteFeedback = { provider: 'github', instance: 'https://api.github.com', id: '9001', url: 'https://github.com/acme/project/issues/7', title: 'Remote report', body: 'Cached remote body', state: 'open', updatedAt: '2026-09-14T00:00:00Z' };
  const path = 'docs/issues/remote.md';
  let writer: ReturnType<typeof openHawdb> | undefined;
  try {
    open(root, repo => {
      createDocument(repo, 'issue', { id: 'remote', title: 'Local', body: 'Local notes' });
      const document = loadDocuments(repo).find(item => item.path === path)!;
      assert.ok(document.metadata.kind === 'issue');
      writeFileSync(join(root, path), renderDocument({ ...document.metadata, source: { ...remote, body: 'First source body', connectionId: 'github-main', importedAt: remote.updatedAt } }, document.body));
      mergeFeedbackCache(repo, 'github-main', [remote]);
    });
    const cache = join(root, '.git/concord/cache.hawdb');
    writer = openHawdb(cache, { readOnly: false, create: false }, nativeRuntime);
    const reading = runApplication(getViewFile(root, path));
    await runApplication(Effect.sleep('50 millis'));
    writer.close(); writer = undefined;
    const readable = await reading;
    assert.equal(readable.feedback?.remote?.body, 'Cached remote body');

    writer = openHawdb(cache, { readOnly: false, create: false }, nativeRuntime);
    const unavailable = await runApplication(getViewFile(root, path));
    assert.equal(unavailable.feedback?.remote, null);
    assert.equal(unavailable.feedback?.document.metadata.source?.body, 'First source body');
    assert.equal(unavailable.feedback?.document.body, '# Local\n\nLocal notes\n');
    assert.ok(unavailable.feedback?.warnings.some(warning => warning.includes('Feedback cache unavailable')));
  } finally { writer?.close(); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/feedback/use-case/triage-feedback.md
test('feedback workspace stays tolerant and readonly when its cache table or unrelated owners are unavailable', async () => {
  const root = fixture(false);
  const uninitialized = mkdtempSync(join(tmpdir(), 'concord-feedback-uninitialized-'));
  try {
    execFileSync('git', ['init', '-q', uninitialized]);
    assert.deepEqual((await runApplication(getWorkspaceSnapshot(uninitialized))).feedback, []);
    open(root, repo => createDocument(repo, 'issue', { id: 'local-note', title: 'Local note' }));
    mkdirSync(join(root, 'memory'), { recursive: true });
    writeFileSync(join(root, 'memory', 'broken.md'), '---\nformat: concord.document/v1\nid: broken\n---\n');
    const cache = join(root, '.git', 'concord', 'cache.hawdb');
    assert.equal(existsSync(cache), false);
    const workspace = await runApplication(getWorkspaceSnapshot(root));
    assert.deepEqual(workspace.feedback.map(item => item.document.metadata.id), ['local-note']);
    assert.equal(existsSync(cache), false, 'workspace polling must not create a feedback cache');
    rmSync(join(root, 'memory', 'broken.md'));

    open(root, repo => { PersistentCache.repository(repo).prepareWrite({ create: true }); scanAnnotations(repo, { cache: 'rebuild' }); });
    const before = readdirSync(cache).sort();
    open(root, repo => assert.deepEqual(listFeedback(repo).map(item => item.document.metadata.id), ['local-note']));
    assert.deepEqual(readdirSync(cache).sort(), before, 'reading a database without feedback_cache must stay readonly');
    const database = openHawdb(cache, { readOnly: true, create: false }, nativeRuntime);
    try { assert.deepEqual(database.scan('feedback_cache'), []); }
    finally { database.close(); }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(uninitialized, { recursive: true, force: true });
  }
});

// @use-case docs/feature/feedback/use-case/triage-feedback.md
test('sync binds and imports atomically while repeat sync preserves editable local state and first source snapshot', async () => {
  const root = fixture();
  try {
    const first = await runApplication(syncFeedback(root, 'github-main', { transport: githubTransport([issue()]), credential: 'test-token' }));
    assert.equal(first.imported, 1);
    assert.deepEqual([...first.changedPaths].sort(), ['concord.config.ts', 'docs/issues/feedback-github-9001.md']);
    open(root, repo => {
      const config = showConfig(repo).config.feedbackConnections?.[0];
      assert.equal(config?.provider === 'github' ? config.repositoryId : undefined, '42');
      assert.match(cacheStatus(repo, nativeRuntime).detail ?? '', /feedback_cache/u);
      const document = loadDocuments(repo).find(item => item.metadata.id === 'feedback-github-9001')!;
      assert.equal(document.metadata.kind === 'issue' ? document.metadata.source?.body : undefined, '');
      setAuthor(repo, document.path, document.body.replace(/^# .+/mu, '# Local title'), document.digest);
      const edited = loadDocuments(repo).find(item => item.metadata.id === 'feedback-github-9001')!;
      setAuthor(repo, edited.path, '# Local investigation\n', edited.digest);
    });
    const second = await runApplication(syncFeedback(root, 'github-main', {
      transport: githubTransport([issue({ title: 'Changed remote title', body: 'Remote rewrite', state: 'closed', updated_at: '2026-09-14T01:00:00Z' })]),
      credential: 'test-token',
    }));
    assert.equal(second.imported, 0);
    open(root, repo => {
      const item = listFeedback(repo)[0]!;
      assert.equal(item.document.metadata.title, 'Local investigation');
      assert.equal(item.document.body, '# Local investigation\n');
      assert.equal(item.document.metadata.source?.title, 'Remote report');
      assert.equal(item.remote?.title, 'Changed remote title');
      assert.equal(item.triage, 'pending');
      createDocument(repo, 'feature', { id: 'feedback-home', title: 'Feedback home' });
      linkIssue(repo, item.document.metadata.id, 'docs/feature/feedback-home/README.md', false, 'spec');
      assert.equal(listFeedback(repo)[0]?.triage, 'linked');
      closeIssue(repo, item.document.metadata.id, 'Triaged');
      clearCache(repo, undefined, nativeRuntime);
      assert.deepEqual(listFeedback(repo), []);
    });
    const afterClear = await runApplication(syncFeedback(root, 'github-main', { transport: githubTransport([issue({ state: 'open', updated_at: '2026-09-14T02:00:00Z' })]), credential: 'test-token' }));
    assert.equal(afterClear.imported, 1, 'a deleted local Issue no longer owns the remote identity');
    open(root, repo => {
      const current = showConfig(repo);
      setConfig(repo, { ...current.config, feedbackConnections: [...(current.config.feedbackConnections ?? []), { id: 'github-copy', provider: 'github', credentialEnv: 'TEST_GITHUB_TOKEN', owner: 'acme', repo: 'project' }] }, current.digest);
    });
    const otherConnection = await runApplication(syncFeedback(root, 'github-copy', { transport: githubTransport([issue({ updated_at: '2026-09-14T03:00:00Z' })]), credential: 'test-token' }));
    assert.equal(otherConnection.imported, 0);
    open(root, repo => assert.equal(listFeedback(repo).length, 1, 'the same remote identity across connections remains one local owner'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/feedback/use-case/triage-feedback.md
test('dry-run and failed or stale fetches write neither documents nor cache', async () => {
  const root = fixture(false);
  try {
    const configPath = projectConfigPath(root);
    const before = readFileSync(join(root, configPath), 'utf8');
    const dry = await runApplication(syncFeedback(root, 'github-main', { dryRun: true, transport: githubTransport([issue()]), credential: 'test-token' }));
    assert.equal(dry.imported, 1);
    assert.equal(readFileSync(join(root, configPath), 'utf8'), before);
    assert.equal(existsSync(join(root, 'docs/issues/feedback-github-9001.md')), false);
    assert.equal(existsSync(join(root, '.git/concord/cache.hawdb')), false);

    await assert.rejects(runApplication(syncFeedback(root, 'github-main', { transport: githubTransport([], { failList: true }), credential: 'test-token' })), error => errorCode(error, 'InjectedFailure'));
    assert.equal(readFileSync(join(root, configPath), 'utf8'), before);

    let reached!: () => void, release!: () => void;
    const atList = new Promise<void>(resolve => { reached = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    const running = runApplication(syncFeedback(root, 'github-main', { transport: githubTransport([issue()], { wait, reached }), credential: 'test-token' }));
    await atList;
    open(root, repo => {
      const current = showConfig(repo);
      setConfig(repo, { ...current.config, sourceRoots: ['src'] }, current.digest);
    });
    release();
    await assert.rejects(running, error => errorCode(error, 'FileChangedSinceRead'));
    assert.equal(existsSync(join(root, 'docs/issues/feedback-github-9001.md')), false);
    assert.equal(existsSync(join(root, '.git/concord/cache.hawdb')), false);

    writeFileSync(join(root, '.git/concord/cache.hawdb'), 'not a HawDB directory');
    const cacheFailed = await runApplication(syncFeedback(root, 'github-main', { transport: githubTransport([issue()]), credential: 'test-token' }));
    assert.equal(cacheFailed.imported, 1);
    assert.ok(cacheFailed.warnings.some(warning => warning.includes('cache could not be updated')));
    assert.match(humanOutput(cacheFailed), /Fetched: 1; imported: 1/u);
    assert.match(humanOutput(cacheFailed), /Warnings:/u);
    const retried = await runApplication(syncFeedback(root, 'github-main', { transport: githubTransport([issue()]), credential: 'test-token' }));
    assert.equal(retried.imported, 0);
    assert.ok(retried.warnings.some(warning => warning.includes('cache could not be updated')));
    open(root, repo => assert.equal(loadDocuments(repo).filter(document => document.metadata.kind === 'issue' && document.metadata.source !== undefined).length, 1));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/feedback/use-case/triage-feedback.md
test('cache compares real instants, rejects unsafe paths, and duplicate source identities are findings plus sync failures', async () => {
  const root = fixture();
  try {
    await runApplication(syncFeedback(root, 'github-main', { transport: githubTransport([issue()]), credential: 'test-token' }));
    open(root, repo => {
      const stale: RemoteFeedback = { provider: 'github', instance: 'https://api.github.com', id: '9001', url: 'https://github.com/acme/project/issues/7', title: 'Stale', body: '', state: 'open', updatedAt: '2026-09-14T00:00:00Z' };
      mergeFeedbackCache(repo, 'github-main', [stale]);
      assert.equal(readFeedbackCache(repo).items.values().next().value?.remote.title, 'Remote report');
      const original = loadDocuments(repo).find(item => item.metadata.id === 'feedback-github-9001')!;
      const duplicate = { ...original.metadata, id: 'duplicate-feedback' };
      writeFileSync(join(root, 'docs/issues/duplicate-feedback.md'), renderDocument(duplicate, original.body));
      assert.ok(checkDocuments(repo, loadDocuments(repo)).some(finding => finding.code === 'DuplicateFeedbackSource'));
    });
    await assert.rejects(runApplication(syncFeedback(root, 'github-main', { transport: githubTransport([issue()]), credential: 'test-token' })), error => errorCode(error, 'FeedbackIdentityConflict'));
    rmSync(join(root, 'docs/issues/duplicate-feedback.md'));
    open(root, repo => clearCache(repo, undefined, nativeRuntime));
    const dangling = join(root, '.git/concord/cache.hawdb');
    rmSync(dangling, { recursive: true });
    symlinkSync(join(root, 'missing-cache-target'), dangling);
    open(root, repo => assert.throws(() => readFeedbackCache(repo), error => errorCode(error, 'UnsafePath')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('one feedback fetch merges repeated identities against earlier entries in the same batch', () => {
  const root = fixture();
  try {
    const remote: RemoteFeedback = { provider: 'github', instance: 'https://api.github.com', id: '9001', url: 'https://github.com/acme/project/issues/7', title: 'Initial', body: '', state: 'open', updatedAt: '2026-09-14T00:00:00Z' };
    open(root, repo => {
      const warnings = mergeFeedbackCache(repo, 'github-main', [
        remote,
        { ...remote, title: 'Newer', updatedAt: '2026-09-14T01:00:00Z' },
        { ...remote, title: 'Stale', updatedAt: '2026-09-14T00:30:00Z' },
        { ...remote, title: 'Conflict', updatedAt: '2026-09-14T01:00:00Z' },
      ]);
      assert.equal(warnings.length, 1);
      assert.equal([...readFeedbackCache(repo).items.values()][0]?.remote.title, 'Newer');
      const database = openHawdb(join(repo.privateDir, 'cache.hawdb'), { readOnly: true, create: false }, nativeRuntime);
      try { assert.equal(database.scan('feedback_cache').length, 1, 'the merged entry was published to HawDB'); }
      finally { database.close(); }
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('feedback cache rejects a damaged HawDB payload and never partially publishes an oversized identity batch', () => {
  const root = fixture();
  try {
    const remote: RemoteFeedback = { provider: 'github', instance: 'https://api.github.com', id: '9001', url: 'https://github.com/acme/project/issues/7', title: 'Original', body: '', state: 'open', updatedAt: '2026-09-14T00:00:00Z' };
    open(root, repo => {
      assert.throws(() => mergeFeedbackCache(repo, 'github-main', Array.from({ length: 1001 }, (_, index) => ({ ...remote, id: String(index + 1) }))), error => errorCode(error, 'HawdbLimit'));
      const path = join(repo.privateDir, 'cache.hawdb');
      const database = openHawdb(path, { readOnly: true, create: false }, nativeRuntime);
      try { assert.deepEqual(database.scan('feedback_cache'), []); }
      finally { database.close(); }
      mergeFeedbackCache(repo, 'github-main', [remote]);
      const writer = openHawdb(path, { readOnly: false, create: false }, nativeRuntime);
      try {
        const row = writer.scan('feedback_cache')[0]!;
        writer.put('feedback_cache', [{ key: row.key, payload: '{' }]);
      } finally { writer.close(); }
      assert.throws(() => readFeedbackCache(repo), error => errorCode(error, 'InvalidCache'));
      assert.throws(() => mergeFeedbackCache(repo, 'github-main', [{ ...remote, updatedAt: '2026-09-14T01:00:00Z' }]), error => errorCode(error, 'InvalidCache'));
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
