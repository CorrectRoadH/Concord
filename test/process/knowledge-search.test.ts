// 跨进程保证：原生模块与句柄——真实数据库 Worker 返回完整搜索结果并复用已核验来源。
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { Schema } from 'effect';
import { makeKnowledgeSearchOwner } from '../../src/app/index.ts';
import { DatabaseWorker, KnowledgeResult, type DatabaseOperation } from '../../src/base/cache/index.ts';
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { LocalRepository } from '../../src/base/workspace/index.ts';
import { digest, renderDocument, type FeedbackSource } from '../../src/model/index.ts';
import { createConsumer } from '../support/consumer.ts';

type SearchRequest = Extract<DatabaseOperation, { op: 'search' }>;
type SearchKind = 'memory' | 'issue';
const decodeResult = Schema.decodeUnknownSync(KnowledgeResult, { onExcessProperty: 'error' });

function writeDocument(root: string, kind: SearchKind, id: string, title: string, text: string, source?: FeedbackSource) {
  const path = `${kind === 'memory' ? 'memory' : 'docs/issues'}/${id}.md`;
  const body = `# ${title}\n\n${text}\n`;
  const common = { format: 'concord.document/v1' as const, id, title, relations: [] };
  const contents = renderDocument(kind === 'memory' ? { ...common, kind } : { ...common, kind, ...(source === undefined ? {} : { source }) }, body);
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), contents);
  return { path, id, title, body, digest: digest(contents), ...(kind === 'issue' ? { provider: source?.provider ?? 'local' as const } : {}) };
}

async function withSearch(memory: boolean, run: (fixture: {
  readonly root: string;
  readonly worker: DatabaseWorker;
  readonly owner: ReturnType<typeof makeKnowledgeSearchOwner>;
  readonly reads: string[];
  readonly requests: SearchRequest[];
  readonly replies: KnowledgeResult[];
  readonly search: (kind: SearchKind, query: string) => ReturnType<ReturnType<typeof makeKnowledgeSearchOwner>['search']>;
}) => Promise<void>) {
  const root = await createConsumer();
  // Keep the observed collections exact; navigation pages are not search documents.
  rmSync(join(root, 'memory/README.md'), { force: true });
  rmSync(join(root, 'docs/issues/README.md'), { force: true });
  const runtime = makeRuntimeEnvironment(root, process.env);
  const repo = await LocalRepository.open(root, { access: 'read', persistentCache: memory ? 'off' : 'use', runtime });
  const worker = new DatabaseWorker();
  try {
    await worker.request({ op: 'open', privateDir: memory ? null : repo.privateDir, runtime });
    const reads: string[] = [], requests: SearchRequest[] = [], replies: KnowledgeResult[] = [];
    const readIdentified = repo.readIdentified.bind(repo);
    repo.readIdentified = (path, identity) => { reads.push(path); return readIdentified(path, identity); };
    const owner = makeKnowledgeSearchOwner({
      search: async (input, signal) => {
        requests.push(input);
        const reply = decodeResult(await worker.request(input, { signal }));
        replies.push(reply);
        return reply;
      },
      discard: async (kind, memory, signal) => { await worker.request({ op: 'discard-search', kind, memory }, { signal }); },
    });
    await run({ root, worker, owner, reads, requests, replies, search: async (kind, query) => {
      const reply = await owner.search(repo, kind, query);
      assert.equal(owner.diagnostic, undefined, 'the real native backend must succeed without a source-scan fallback');
      assert.equal(requests.at(-1)?.memory, memory);
      return reply;
    } });
  } finally {
    try { await worker.close(); }
    finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
  }
}

const importedAt = '2026-11-13T00:00:00Z';
const github: FeedbackSource = {
  provider: 'github', instance: 'https://api.github.com', id: '41', url: 'https://github.com/acme/search/issues/41',
  title: 'Remote GitHub title', body: 'Remote-only text', state: 'open', updatedAt: importedAt, importedAt, connectionId: 'github-search',
};
const linear: FeedbackSource = {
  provider: 'linear', instance: 'https://api.linear.app', id: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222', url: 'https://linear.app/acme/issue/SEARCH-1',
  title: 'Remote Linear title', body: 'Remote-only text', state: 'open', updatedAt: importedAt, importedAt, connectionId: 'linear-search',
};

// @use-case docs/feature/local-data-engine/use-case/query-current-projections.md#search
test('native search preserves Memory and Issue bodies, digests, full output and source providers', async () => {
  for (const memory of [false, true]) await withSearch(memory, async ({ root, search }) => {
    const note = writeDocument(root, 'memory', 'note', 'Current Memory', 'A shared needle in the local body.');
    const issues = [
      writeDocument(root, 'issue', 'github', 'Current GitHub note', 'A shared needle in local GitHub notes.', github),
      writeDocument(root, 'issue', 'linear', 'Current Linear note', 'A shared needle in local Linear notes.', linear),
      writeDocument(root, 'issue', 'local', 'Current local note', 'A shared needle in local notes.'),
    ];
    assert.deepEqual(await search('memory', '  SHARED   needle  '), { operation: 'memory-search', query: '  SHARED   needle  ', documents: [note] });
    assert.deepEqual(await search('issue', 'shared needle'), { operation: 'issue-search', query: 'shared needle', documents: issues });
    assert.deepEqual((await search('issue', 'remote-only')).documents, [], 'remote source metadata is not the authored searchable body');
  });
});

// @use-case docs/feature/local-data-engine/use-case/query-current-projections.md#edit
test('native search reads the cold collection, no hot bodies and only one externally changed body', async () => {
  for (const memory of [false, true]) await withSearch(memory, async ({ root, search, reads, requests }) => {
    for (const kind of ['memory', 'issue'] as const) {
      reads.length = 0;
      const first = writeDocument(root, kind, 'first', 'First note', 'Needle original.');
      const second = writeDocument(root, kind, 'second', 'Second note', 'Needle steady.');
      assert.deepEqual((await search(kind, 'needle')).documents, [first, second]);
      assert.deepEqual([...reads].sort(), [first.path, second.path]);
      assert.equal(requests.at(-1)?.update?.documents.length, 2);
      reads.length = 0;
      assert.deepEqual((await search(kind, 'steady')).documents, [second]);
      assert.deepEqual(reads, []);
      assert.equal(requests.at(-1)?.update, undefined);

      const changed = writeDocument(root, kind, 'first', 'First note', 'Replacement current content.');
      assert.notEqual(changed.digest, first.digest);
      assert.deepEqual((await search(kind, 'replacement')).documents, [changed]);
      assert.deepEqual(reads, [first.path]);
      assert.deepEqual(requests.at(-1)?.update?.documents.map(document => document.path), [first.path]);
      reads.length = 0;
      assert.deepEqual((await search(kind, 'original')).documents, []);
      assert.deepEqual((await search(kind, 'needle')).documents, [second]);
      assert.deepEqual(reads, []);
    }
  });
});

// @use-case docs/feature/local-data-engine/use-case/query-current-projections.md#search
test('native zero-hit queries and U+0085 literal regex recall keep exact complete results', async () => {
  for (const memory of [false, true]) await withSearch(memory, async ({ root, search, reads, replies }) => {
    const special = writeDocument(root, 'memory', 'special', 'Literal note', 'Needle \u0085 literal.* [a] \\ Ω\nsecond line.');
    writeDocument(root, 'memory', 'ordinary', 'Ordinary note', 'Needle without the special character.');
    assert.deepEqual((await search('memory', 'not-present')).documents, []);
    assert.deepEqual(replies.at(-1)?.documents, [], 'zero hits are returned by the real Worker');
    reads.length = 0;
    for (const query of ['\u0085', '\u0085 needle', 'needle \u0085', '\u0085 \u0085', '\u0085 literal.* [a] \\', '\u0085 second', '\u0085 Ω']) {
      assert.deepEqual((await search('memory', query)).documents, [special], JSON.stringify({ memory, query }));
      assert.deepEqual(replies.at(-1)?.documents.map(document => document.path), [special.path]);
    }
    assert.deepEqual((await search('memory', '\u0085 absent')).documents, []);
    assert.deepEqual(reads, [], 'zero-hit rechecks stay inside the native database after source warming');
  });
});

// @use-case docs/feature/local-data-engine/use-case/query-current-projections.md#search
test('native search returns all 1001 owner records across the cursor page boundary', async () => {
  for (const memory of [false, true]) await withSearch(memory, async ({ root, search, reads, replies }) => {
    const expected = Array.from({ length: 1001 }, (_, index) => writeDocument(root, 'memory', `page-${String(index).padStart(4, '0')}`, `Page ${index}`, `Common needle body ${index}.`));
    assert.deepEqual((await search('memory', 'common needle')).documents, expected);
    assert.equal(replies.at(-1)?.documents.length, 1001, 'all pages cross the Worker boundary before a reply');
    assert.equal(replies.at(-1)?.generation.documentCount, 1001);
    assert.equal(reads.length, 1001);
    reads.length = 0;
    assert.deepEqual((await search('memory', 'needle common')).documents, expected);
    assert.deepEqual(reads, []);
  });
});

// @use-case docs/feature/local-data-engine/use-case/query-current-projections.md#rebuild
test('service owner invalidation rebuilds both native collections, including after persistent Worker clear', async () => {
  for (const memory of [false, true]) await withSearch(memory, async ({ root, worker, owner, search, reads, requests }) => {
    const note = writeDocument(root, 'memory', 'rebuild', 'Rebuild note', 'Needle remains current.');
    const issue = writeDocument(root, 'issue', 'rebuild', 'Rebuild issue', 'Needle remains current.');
    assert.deepEqual((await search('memory', 'needle')).documents, [note]);
    assert.deepEqual((await search('issue', 'needle')).documents, [issue]);
    for (const clear of memory ? [false] : [false, true]) {
      const previous = requests.map(request => request.generation);
      if (clear) await worker.request({ op: 'clear' });
      owner.invalidate();
      reads.length = 0;
      assert.deepEqual((await search('memory', 'needle')).documents, [note]);
      const memoryRequest = requests.at(-1)!;
      assert.equal(memoryRequest.update?.previous, null);
      assert.deepEqual(memoryRequest.update?.documents.map(document => document.path), [note.path]);
      assert.ok(!previous.includes(memoryRequest.generation));
      assert.deepEqual((await search('issue', 'needle')).documents, [issue]);
      assert.equal(requests.at(-1)?.update?.previous, null);
      assert.deepEqual([...reads].sort(), [issue.path, note.path]);
      reads.length = 0;
      assert.deepEqual((await search('memory', 'current')).documents, [note]);
      assert.deepEqual((await search('issue', 'current')).documents, [issue]);
      assert.deepEqual(reads, []);
    }
  });
});
