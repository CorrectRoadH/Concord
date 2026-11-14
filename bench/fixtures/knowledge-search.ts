import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { join } from 'node:path';
import { NodeServices } from '@effect/platform-node';
import { Effect, Exit, FileSystem, ManagedRuntime, Schema, Scope } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { knowledgeSearchRecords, makeKnowledgeSearchOwner } from '../../src/app/index.ts';
import { DatabaseWorker, KnowledgeResult, type KnowledgeKind } from '../../src/base/cache/index.ts';
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { LocalRepository } from '../../src/base/workspace/index.ts';
import { decodeUncachedDocumentSource, digest, inRepositorySnapshot } from '../../src/model/index.ts';

export type SearchStorage = 'persistent' | 'memory';
export type SearchHits = 'zero' | 'rare' | 'high' | 'no-gram';
export type SearchState = 'cold' | 'warm' | 'change' | 'reopen' | 'clear';
type SearchReply = Awaited<ReturnType<typeof knowledgeSearchRecords>>;
const words: Readonly<Record<SearchHits, readonly string[]>> = {
  zero: ['absenttokenq7', '从不存在的词', 'snapshot absenttokenq7'],
  rare: ['needlex9', '罕见词', 'Snapshot needlex9'],
  high: ['缓', 'Snapshot', 'current'],
  'no-gram': ['\u0085', '\u0085 snapshot'],
};
const rootFor = (kind: KnowledgeKind) => kind === 'memory' ? 'memory' : 'docs/issues';
const pathFor = (kind: KnowledgeKind, index: number) => `${rootFor(kind)}/record-${String(index).padStart(5, '0')}.md`;

/** Every complete source is exactly 1 KiB; rare and no-gram words have fixed cardinalities. */
function sourceFor(index: number, size: number, edit = 0): string {
  const lead = `# Knowledge ${index}\n\n缓存 Snapshot current facts retain complete bilingual evidence.\n\n`
    + (index >= size - 2 ? 'needlex9 罕见词\n\n' : '')
    + (index === size - 1 ? 'Control character: \u0085\n\n' : '')
    + (edit ? `updated-marker edit-${edit}\n\n` : '');
  const line = 'Current evidence 来自当前来源，缓存可以重建。 Snapshot facts remain complete.\n';
  const repeated = line.repeat(Math.floor((1023 - Buffer.byteLength(lead)) / Buffer.byteLength(line)));
  return lead + repeated + '.'.repeat(1023 - Buffer.byteLength(lead + repeated)) + '\n';
}

interface SourceReads { bodies: number; bytes: number; discoveries: number; identities: number }
const emptyReads = (): SourceReads => ({ bodies: 0, bytes: 0, discoveries: 0, identities: 0 });

/** Instrument only this adapter instance; native work and LocalRepository snapshots stay intact. */
function observe(repo: LocalRepository, reads: SourceReads): LocalRepository {
  const identified = repo.readIdentified.bind(repo), read = repo.read.bind(repo), identities = repo.fileIdentities.bind(repo);
  const record = (path: string, source: string | undefined) => {
    if (/^(?:memory|docs\/issues)\/.*\.md$/u.test(path)) {
      reads.bodies++;
      reads.bytes += source === undefined ? 0 : Buffer.byteLength(source);
    }
    return source;
  };
  repo.readIdentified = (path, identity) => {
    const source = identified(path, identity);
    record(path, source);
    return source;
  };
  repo.read = path => record(path, read(path));
  repo.fileIdentities = prefix => {
    const result = identities(prefix);
    reads.discoveries++;
    reads.identities += result.length;
    return result;
  };
  return repo;
}

/** Reference scan uses the same strict product decoder and real source snapshot, without a projection. */
function scan(repo: LocalRepository, kind: KnowledgeKind, query: string): SearchReply {
  return inRepositorySnapshot(repo, () => {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
    const documents: SearchReply['documents'][number][] = [];
    for (const file of repo.fileIdentities(rootFor(kind))) {
      if (!file.path.endsWith('.md')) continue;
      const record = decodeUncachedDocumentSource(file.path, repo.readIdentified(file.path, file.identity));
      if (!record || record.metadata.kind !== kind) continue;
      const text = `${record.metadata.title}\n${record.body}`.toLocaleLowerCase();
      if (terms.every(term => text.includes(term))) documents.push({
        path: record.path, id: record.metadata.id, title: record.metadata.title, body: record.body, digest: record.digest,
        ...(kind === 'issue' ? { provider: record.metadata.kind === 'issue' ? record.metadata.source?.provider ?? 'local' : 'local' } : {}),
      });
    }
    return { operation: `${kind}-search`, query, documents: documents.sort((a, b) => a.path.localeCompare(b.path)) };
  });
}

async function childScope(parent: Scope.Scope): Promise<Scope.Closeable> {
  return Effect.runPromise(Scope.fork(parent, 'sequential'));
}
const closeScope = (scope: Scope.Closeable) => Effect.runPromise(Scope.close(scope, Exit.void));

async function makeCorpus(parent: Scope.Scope, kind: KnowledgeKind, size: number) {
  const scope = await childScope(parent), runtime = ManagedRuntime.make(NodeServices.layer);
  await Effect.runPromise(Scope.addFinalizer(scope, runtime.disposeEffect));
  try {
    const root = await runtime.runPromise(Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem;
      const temporary = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-search-bench-' });
      const root = yield* fs.realPath(temporary);
      const child = yield* (yield* ChildProcessSpawner.ChildProcessSpawner).spawn(ChildProcess.make('git', ['-C', root, 'init', '-q'], { stdin: 'ignore', stdout: 'ignore', stderr: 'inherit' }));
      strictEqual(yield* child.exitCode, 0, 'search fixture git init');
      yield* fs.makeDirectory(join(root, rootFor(kind)), { recursive: true });
      for (let index = 0; index < size; index++) yield* fs.writeFileString(join(root, pathFor(kind, index)), sourceFor(index, size));
      return root;
    }).pipe(Scope.provide(scope)));
    let edit = 0;
    const replaceFirst = async (changed: boolean) => runtime.runPromise(Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem, path = join(root, pathFor(kind, 0));
      // Rename rather than overwrite: even same-sized changes have a distinct source identity.
      yield* fs.writeFileString(`${path}.next`, sourceFor(0, size, changed ? ++edit : 0));
      yield* fs.rename(`${path}.next`, path);
    }));
    const inputDigest = digest(Array.from({ length: size }, (_, index) => `${pathFor(kind, index)}:${digest(sourceFor(index, size))}`).join('\n'));
    return { root, scope, runtime, replaceFirst, inputDigest, size };
  } catch (cause) { await closeScope(scope); throw cause; }
}
type Corpus = Awaited<ReturnType<typeof makeCorpus>>;
const corpora = new WeakMap<Scope.Scope, Map<string, Promise<Corpus>>>();
const validated = new WeakMap<Scope.Scope, Map<string, Promise<void>>>();

async function makeSession(parent: Scope.Scope, corpus: Corpus, kind: KnowledgeKind, storage: SearchStorage, captureNative = false) {
  const scope = await childScope(parent), reads = emptyReads();
  const runtime = makeRuntimeEnvironment(corpus.root, process.env);
  let worker: DatabaseWorker | undefined, repo: LocalRepository | undefined, nativeResult: KnowledgeResult | undefined;
  let nativeResponses = 0;
  try {
    const privateDir = await corpus.runtime.runPromise(Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem;
      const temporary = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-search-db-' });
      return yield* fs.realPath(temporary);
    }).pipe(Scope.provide(scope)));
    // Temp removal must follow the Worker drain, including failed opening.
    await Effect.runPromise(Scope.addFinalizer(scope, Effect.promise(async () => {
      try { repo?.close(); } finally { await worker?.close(); }
    })));
    const owner = makeKnowledgeSearchOwner({
      search: async (input, signal) => {
        const result = Schema.decodeUnknownSync(KnowledgeResult, { onExcessProperty: 'error' })(await worker!.request(input, { signal }));
        nativeResponses++;
        if (captureNative) nativeResult = result;
        return result;
      },
      discard: async (kind, memory, signal) => { await worker!.request({ op: 'discard-search', kind, memory }, { signal }); },
    });
    const open = async () => {
      repo = observe(await LocalRepository.open(corpus.root, { access: 'read', runtime }), reads);
      worker = new DatabaseWorker();
      await worker.request({ op: 'open', privateDir: storage === 'persistent' ? privateDir : null, runtime });
    };
    await open();
    const search = async (query: string, bodies?: number | 'cold') => {
      Object.assign(reads, emptyReads());
      const before = nativeResponses;
      const result = await knowledgeSearchRecords(repo!, kind, query, owner);
      strictEqual(nativeResponses, before + 1, 'native benchmark must not silently degrade to a JavaScript scan');
      if (storage === 'persistent') strictEqual(owner.diagnostic, undefined, 'persistent benchmark must use its persistent database');
      else strictEqual(owner.diagnostic?.startsWith('HawdbUnavailable:'), true, 'memory benchmark must exercise the unavailable persistent database fallback');
      if (bodies === 'cold') ok(reads.bodies >= corpus.size, 'cold owner must verify every source body');
      else if (bodies !== undefined) strictEqual(reads.bodies, bodies, `${kind}/${storage}: source body reads`);
      strictEqual(reads.discoveries, 1, 'each query must discover current source identities');
      strictEqual(reads.identities, corpus.size, 'complete source inventory');
      return result;
    };
    return {
      reads, search,
      nativeResult: () => { if (!nativeResult) throw new Error('Native result observation was not requested'); return nativeResult; },
      scan: (query: string) => {
        Object.assign(reads, emptyReads());
        const result = scan(repo!, kind, query);
        strictEqual(reads.bodies, corpus.size, 'reference scan reads the complete source collection');
        strictEqual(reads.discoveries, 1, 'reference scan discovers current identities');
        return result;
      },
      reopen: async () => { repo!.close(); await worker!.close(); owner.invalidate(); await open(); },
      clear: async () => { await worker!.request({ op: 'clear' }); owner.invalidate(); },
      close: () => closeScope(scope),
    };
  } catch (cause) { await closeScope(scope); throw cause; }
}
type Session = Awaited<ReturnType<typeof makeSession>>;

async function verify(corpus: Corpus, kind: KnowledgeKind, size: number, storage: SearchStorage): Promise<void> {
  const session = await makeSession(corpus.scope, corpus, kind, storage, true);
  try {
    const cold = await session.search(words.rare[0]!, 'cold');
    const coldReads = { ...session.reads };
    deepStrictEqual(cold, session.scan(words.rare[0]!));
    for (const hits of ['zero', 'rare', 'high', 'no-gram'] as const) {
      for (const query of words[hits]) {
        const expected = session.scan(query), actual = await session.search(query, 0);
        deepStrictEqual(actual, expected);
        const rows = hits === 'zero' ? 0 : hits === 'rare' ? 2 : hits === 'high' ? size : 1;
        strictEqual(actual.documents.length, rows, `${hits}: complete match count`);
      }
      await session.search(words[hits][0]!, 0);
      const native = session.nativeResult();
      console.error(`${kind}/${storage}/${size}/${hits}: source bodies=${session.reads.bodies}, identity discoveries=${session.reads.discoveries}, observed files=${size}, returned rows=${native.documents.length}, document JSON bytes=${Buffer.byteLength(JSON.stringify(native.documents))}, generation JSON bytes=${Buffer.byteLength(JSON.stringify(native.generation))}`);
    }
    await corpus.replaceFirst(true);
    const changed = await session.search('updated-marker', 1);
    deepStrictEqual(changed, session.scan('updated-marker'));
    strictEqual(changed.documents.length, 1, 'single changed document');
    console.error(`${kind}/${storage}/${size}: input=${corpus.inputDigest}; cold body reads=${coldReads.bodies}, cold source bytes=${coldReads.bytes}; warm body reads=0; changed body reads=1; native candidates/pages/index memory/internal batch duration=unobservable`);
  } finally {
    await session.close();
    await corpus.replaceFirst(false);
  }
}

/** Scenarios share only deterministic source files. Every prepared request owns its database session. */
export async function knowledgeSearchFixture(parent: Scope.Scope, kind: KnowledgeKind, size: number, storage: SearchStorage) {
  let sources = corpora.get(parent);
  if (!sources) { sources = new Map(); corpora.set(parent, sources); }
  const key = `${kind}/${size}`;
  let corpusPromise = sources.get(key);
  if (!corpusPromise) { corpusPromise = makeCorpus(parent, kind, size); sources.set(key, corpusPromise); }
  const corpus = await corpusPromise;
  let checks = validated.get(parent);
  if (!checks) { checks = new Map(); validated.set(parent, checks); }
  const checkKey = `${key}/${storage}`;
  let check = checks.get(checkKey);
  if (!check) { check = verify(corpus, kind, size, storage); checks.set(checkKey, check); }
  await check;
  const scope = await childScope(parent);
  let cursor = 0, warm: Session | undefined;
  const completed = new Set<Session>();
  const reap = async () => { for (const session of completed) { await session.close(); completed.delete(session); } };
  try {
    await corpus.replaceFirst(false);
    warm = await makeSession(scope, corpus, kind, storage);
    await warm.search(words.rare[0]!, 'cold');
    return {
      warm: async (hits: SearchHits) => {
        const queries = words[hits], query = queries[cursor++ % queries.length]!;
        const result = await warm!.search(query, 0);
        strictEqual(result.documents.length, hits === 'zero' ? 0 : hits === 'rare' ? 2 : hits === 'high' ? size : 1);
        return result;
      },
      scan: (hits: SearchHits) => { const queries = words[hits]; return warm!.scan(queries[cursor++ % queries.length]!); },
      prepare: async (state: Exclude<SearchState, 'warm'>) => {
        await reap();
        const session = await makeSession(scope, corpus, kind, storage);
        if (state !== 'cold') await session.search(words.high[0]!, 'cold');
        if (state === 'change') await corpus.replaceFirst(true);
        return session;
      },
      query: async (session: Session, state: Exclude<SearchState, 'warm'>, hits: SearchHits) => {
        try {
          if (state === 'reopen') await session.reopen();
          if (state === 'clear') await session.clear();
          const queries = words[hits], query = state === 'change' ? 'updated-marker' : queries[cursor++ % queries.length]!;
          const result = await session.search(query, state === 'change' ? 1 : 'cold');
          strictEqual(result.documents.length, state === 'change' ? 1 : hits === 'zero' ? 0 : hits === 'rare' ? 2 : hits === 'high' ? size : 1);
          return result;
        } finally { completed.add(session); }
      },
      close: async () => { await closeScope(scope); await corpus.replaceFirst(false); },
    };
  } catch (cause) { await closeScope(scope); throw cause; }
}
