// Real Worker requests observe transactions, paging, cancellation and handle release.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Schema } from 'effect';
import { DatabaseWorker, KnowledgeResult, acquireHawdbClearGuard, inspectCacheClear, openHawdb, type KnowledgeDocument, type KnowledgeGeneration, type KnowledgeKind, type KnowledgeUpdate } from '../../src/base/cache/index.ts';
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { tmpdir } from '../support/temporary.ts';

const runtime = makeRuntimeEnvironment(process.cwd(), process.env);
const result = Schema.decodeUnknownSync(KnowledgeResult, { onExcessProperty: 'error' });
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
function document(index: number, body = 'needle common Ω', kind: KnowledgeKind = 'memory'): KnowledgeDocument {
  const path = `${kind === 'memory' ? 'memory' : 'docs/issues'}/document-${String(index).padStart(5, '0')}.md`, title = `Document ${index}`;
  return { path, id: `document-${index}`, title, body, digest: digest(body), searchText: `${title}\n${body}`.toLocaleLowerCase(), ...(kind === 'issue' ? { provider: 'local' as const } : {}) };
}
function update(documents: readonly KnowledgeDocument[], options: { kind?: KnowledgeKind; previous?: string; removed?: readonly string[]; all?: readonly KnowledgeDocument[] } = {}): KnowledgeUpdate {
  const all = options.all ?? documents;
  let generation: KnowledgeGeneration = { kind: options.kind ?? 'memory', generation: randomUUID(), definitionDigest: digest('native-worker-test/current'), sourceDigest: digest(JSON.stringify(all.map(row => [row.path, row.digest]))), documentCount: all.length, logicalBytes: 0 };
  const bytes = all.reduce((total, row) => total + Buffer.byteLength(JSON.stringify(row)), 0);
  for (let index = 0; index < 4; index++) generation = { ...generation, logicalBytes: bytes + Buffer.byteLength(JSON.stringify(generation)) };
  return { generation, previous: options.previous ?? null, documents, removed: options.removed ?? [] };
}
async function open(privateDir: string | null) {
  const worker = new DatabaseWorker();
  try { await worker.request({ op: 'open', privateDir, runtime }); return worker; }
  catch (cause) { await worker.close(); throw cause; }
}
function fixture() {
  const privateDir = mkdtempSync(join(tmpdir(), 'concord-hawdb-worker-'));
  return { privateDir, path: join(privateDir, 'cache.hawdb'), cleanup: () => rmSync(privateDir, { recursive: true, force: true }) };
}
function lockInodes(path: string) {
  return readdirSync(path, { recursive: true }).map(String).filter(name => name.endsWith('.lock')).sort().map(name => [name, statSync(join(path, name)).ino]);
}

// @feature docs/feature/local-data-engine/data-model.md#compare-and-replace
test('Worker compare-and-replace, derived rollback and normal close preserve real durable rows', async () => {
  const f = fixture(); const worker = await open(f.privateDir);
  try {
    assert.equal(await worker.request({ op: 'compare', namespace: 'query_cache', key: 'observed', expected: null, payload: 'first' }), true);
    assert.equal(await worker.request({ op: 'compare', namespace: 'query_cache', key: 'observed', expected: null, payload: 'stale' }), false);
    assert.equal(await worker.request({ op: 'compare', namespace: 'query_cache', key: 'observed', expected: 'first', payload: 'second' }), true);
    await assert.rejects(worker.request({ op: 'derived', batches: [
      { namespace: 'code_cache', entries: [{ key: 'must-rollback', payload: 'partial' }] },
      { namespace: 'query_cache', entries: [{ key: 'forbidden-historical-overwrite', payload: 'invalid' }] },
    ] }), { code: 'HawdbIncompatible' });
    assert.deepEqual(await worker.request({ op: 'read', namespace: 'code_cache' }), []);
    assert.deepEqual(await worker.request({ op: 'read', namespace: 'query_cache', keys: ['observed'] }), [{ key: 'observed', payload: 'second' }]);
    await assert.rejects(worker.request({ op: 'read', namespace: 'document_parse' }), { code: 'HawdbIncompatible' });
    const invalid = { op: 'status' as const, unexpected: true };
    await assert.rejects(worker.request(invalid), { code: 'HawdbIncompatible' });
  } finally { await worker.close(); }
  try {
    await worker.close();
    await assert.rejects(worker.request({ op: 'status' }), { code: 'HawdbClosed' });
    const reopened = openHawdb(f.path, { readOnly: true, create: false }, runtime);
    try { assert.deepEqual(reopened.get('query_cache', ['observed']), [{ key: 'observed', payload: 'second' }]); assert.deepEqual(reopened.scan('code_cache'), []); }
    finally { reopened.close(); }
    acquireHawdbClearGuard(f.path, runtime).close();
  } finally { f.cleanup(); }
});

// @use-case docs/feature/local-data-engine/use-case/query-current-projections.md#search
test('Worker search returns complete transaction pages and exact literal Unicode matches in memory and persistent databases', async () => {
  for (const memory of [false, true]) {
    const f = fixture(), worker = await open(memory ? null : f.privateDir);
    try {
      const documents = Array.from({ length: 1003 }, (_, index) => document(index));
      documents[0] = document(0, 'needle common \u0085 literal.* [a] \\ Ω\nnext');
      documents[1] = document(1, 'needle common 中文 Ω');
      documents[2] = document(2, '');
      const initial = update(documents);
      const first = result(await worker.request({ op: 'search', memory, kind: 'memory', generation: initial.generation.generation, terms: ['document'], update: initial }));
      assert.deepEqual(first.documents, [...documents].sort((a, b) => a.path.localeCompare(b.path)));
      assert.deepEqual(first.generation, initial.generation);
      for (const terms of [['needle', 'common'], ['\u0085'], ['\u0085', 'needle'], ['literal.*', '[a]', '\\'], ['中文'], ['ω'], ['not-present'], ['\u0085', 'absent']]) {
        const found = result(await worker.request({ op: 'search', memory, kind: 'memory', generation: initial.generation.generation, terms }));
        assert.deepEqual(found.documents, documents.filter(row => terms.every(term => row.searchText.includes(term))).sort((a, b) => a.path.localeCompare(b.path)), JSON.stringify({ memory, terms }));
      }
      const changed = document(0, 'replacement only'), remaining = [changed, ...documents.slice(2)];
      const next = update([changed], { previous: initial.generation.generation, removed: [documents[1]!.path], all: remaining });
      const after = result(await worker.request({ op: 'search', memory, kind: 'memory', generation: next.generation.generation, terms: ['needle'], update: next }));
      assert.deepEqual(after.documents, remaining.filter(row => row.searchText.includes('needle')).sort((a, b) => a.path.localeCompare(b.path)));
      await assert.rejects(worker.request({ op: 'search', memory, kind: 'memory', generation: initial.generation.generation, terms: ['needle'] }), { code: 'HawdbIncompatible' });
      const invalid = update([document(7, 'must rollback')], { previous: next.generation.generation, all: remaining });
      await assert.rejects(worker.request({ op: 'search', memory, kind: 'memory', generation: invalid.generation.generation, terms: ['needle'], update: { ...invalid, generation: { ...invalid.generation, documentCount: remaining.length + 1 } } }), { code: 'HawdbIncompatible' });
      const unchanged = result(await worker.request({ op: 'search', memory, kind: 'memory', generation: next.generation.generation, terms: ['needle'] }));
      assert.deepEqual(unchanged, after, 'a failed write request rolls back documents and generation together');
      const issues = [document(0, 'issue only', 'issue')], issueUpdate = update(issues, { kind: 'issue' });
      assert.deepEqual(result(await worker.request({ op: 'search', memory, kind: 'issue', generation: issueUpdate.generation.generation, terms: ['issue'], update: issueUpdate })).documents, issues);
      await worker.request({ op: 'discard-search', memory, kind: 'memory' });
      await assert.rejects(worker.request({ op: 'search', memory, kind: 'memory', generation: next.generation.generation, terms: ['needle'] }), { code: 'HawdbIncompatible' });
      assert.deepEqual(result(await worker.request({ op: 'search', memory, kind: 'issue', generation: issueUpdate.generation.generation, terms: ['issue'] })).documents, issues);
    } finally { await worker.close(); f.cleanup(); }
  }
});

// @feature docs/feature/local-data-engine/architecture.md#worker-requests
test('Worker cancellation and expired deadlines reject writes, drain close, and release ownership before returning', async () => {
  const f = fixture(), worker = await open(f.privateDir);
  try {
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(worker.request({ op: 'compare', namespace: 'config_cache', key: 'cancelled', expected: null, payload: 'never' }, { signal: aborted.signal }), { code: 'HawdbCancelled' });
    await assert.rejects(worker.request({ op: 'compare', namespace: 'config_cache', key: 'expired', expected: null, payload: 'never' }, { deadline: process.hrtime.bigint() - 1n }), { code: 'HawdbCancelled' });
    assert.deepEqual(await worker.request({ op: 'read', namespace: 'config_cache' }), []);
    const initial = update(Array.from({ length: 1003 }, (_, index) => document(index)));
    const executing = worker.request({ op: 'search', memory: false, kind: 'memory', generation: initial.generation.generation, terms: ['needle'], update: initial });
    const queued = worker.request({ op: 'compare', namespace: 'config_cache', key: 'queued', expected: null, payload: 'never' });
    const outcomes = Promise.allSettled([executing, queued]);
    const close = worker.close();
    await assert.rejects(worker.request({ op: 'status' }), { code: 'HawdbClosed' });
    await close;
    for (const outcome of await outcomes) {
      assert.equal(outcome.status, 'rejected');
      if (outcome.status === 'rejected') assert.equal(outcome.reason.code, 'HawdbCancelled');
    }
    const reopened = openHawdb(f.path, { readOnly: false, create: false }, runtime);
    try { assert.deepEqual(reopened.scan('config_cache'), []); }
    finally { reopened.close(); }
    acquireHawdbClearGuard(f.path, runtime).close();
  } finally { await worker.close(); f.cleanup(); }
});

// @feature docs/feature/local-data-engine/architecture.md#清理
test('Worker clear preserves stable engine locks and cache ownership while replacing data', async () => {
  const f = fixture(), worker = await open(f.privateDir);
  try {
    await worker.request({ op: 'compare', namespace: 'config_cache', key: 'before', expected: null, payload: 'old' });
    const owner = statSync(join(f.path, 'owner.hawdb.lock')).ino, gate = statSync(`${f.path}.concord.lock`).ino;
    assert.throws(() => acquireHawdbClearGuard(f.path, runtime), { code: 'HawdbBusy' });
    const beforeLocks = lockInodes(f.path).filter(([path]) => typeof path === 'string' && !path.includes('/runtime/'));
    await worker.request({ op: 'clear' });
    assert.equal(statSync(join(f.path, 'owner.hawdb.lock')).ino, owner);
    assert.equal(statSync(`${f.path}.concord.lock`).ino, gate);
    for (const [path, inode] of beforeLocks) assert.equal(statSync(join(f.path, String(path))).ino, inode);
    assert.deepEqual(await worker.request({ op: 'read', namespace: 'config_cache' }), []);
    assert.equal(await worker.request({ op: 'compare', namespace: 'config_cache', key: 'after', expected: null, payload: 'current' }), true);
    assert.equal(inspectCacheClear(f.privateDir).empty, false);
  } finally { await worker.close(); f.cleanup(); }
});

// @feature docs/feature/local-data-engine/data-model.md#generation
test('Worker rejects incomplete generation and rolls its graph writes back atomically', async () => {
  const worker = await open(null);
  try {
    const original = document(0), initial = update([original]);
    await worker.request({ op: 'search', memory: true, kind: 'memory', generation: initial.generation.generation, terms: ['needle'], update: initial });
    const next = update([document(0, 'replacement')], { previous: initial.generation.generation });
    await assert.rejects(worker.request({ op: 'search', memory: true, kind: 'memory', generation: next.generation.generation, terms: ['replacement'], update: { ...next, generation: { ...next.generation, documentCount: 2 } } }), { code: 'HawdbIncompatible' });
    assert.deepEqual(result(await worker.request({ op: 'search', memory: true, kind: 'memory', generation: initial.generation.generation, terms: ['needle'] })).documents, [original]);
  } finally { await worker.close(); }
});

// @feature docs/feature/local-data-engine/architecture.md#worker-requests
test('queued cancellation releases admission immediately and foreground requests precede background work', async () => {
  const f = fixture(), worker = await open(f.privateDir);
  try {
    const active = worker.request({ op: 'read', namespace: 'config_cache' });
    const controller = new AbortController();
    const queued = Array.from({ length: 16 }, (_, index) => worker.request({ op: 'read', namespace: 'config_cache' }, index === 0 ? { signal: controller.signal } : {}));
    const outcomes = Promise.allSettled(queued);
    controller.abort();
    const replacement = worker.request({ op: 'read', namespace: 'config_cache' });
    const replacementOutcome = Promise.allSettled([replacement]);
    await active;
    const completed = await outcomes;
    const cancelled = completed[0]!;
    assert.equal(cancelled.status, 'rejected');
    if (cancelled.status === 'rejected') assert.equal(cancelled.reason.code, 'HawdbCancelled');
    assert.deepEqual(await replacementOutcome, [{ status: 'fulfilled', value: [] }], 'an aborted queued item must stop consuming its queue slot');
    const reading = worker.request({ op: 'read', namespace: 'config_cache' });
    const background = worker.request({ op: 'compare', namespace: 'query_cache', key: 'priority', expected: null, payload: 'background' }, { background: true });
    const foreground = worker.request({ op: 'compare', namespace: 'query_cache', key: 'priority', expected: null, payload: 'foreground' });
    await reading;
    assert.equal(await foreground, true); assert.equal(await background, false);
    assert.deepEqual(await worker.request({ op: 'read', namespace: 'query_cache', keys: ['priority'] }), [{ key: 'priority', payload: 'foreground' }]);
  } finally { await worker.close(); f.cleanup(); }
});
