// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/query-current-projections.md
import { randomUUID } from 'node:crypto';
import { Context, Effect, Semaphore, Schema } from 'effect';
import { DatabaseWorker, HawdbFailure, KnowledgeResult, type DatabaseOperation, type KnowledgeDocument, type KnowledgeGeneration } from '../base/cache/index.ts';
import { repositoryRuntime } from '../base/workspace/index.ts';
import { DOCUMENT_PARSER_VERSION } from '../domain/documents/index.ts';
import { ConcordError, decodeUncachedDocumentSource, digest, documentDisposition, inRepositorySnapshot, objectDigest, type DocumentRecord, type Repository } from '../model/index.ts';

type KnowledgeKind = 'memory' | 'issue';
type SearchInput = Extract<DatabaseOperation, { op: 'search' }>;
export interface KnowledgeSearchReply {
  readonly operation: string; readonly query: string;
  readonly documents: readonly { readonly path: string; readonly id: string; readonly title: string; readonly body: string; readonly digest: string; readonly provider?: 'local' | 'github' | 'linear' }[];
}
export interface KnowledgeSearchOwner {
  search(repo: Repository, kind: KnowledgeKind, query: string, signal?: AbortSignal): Promise<KnowledgeSearchReply>;
  invalidate(): void;
  readonly diagnostic: string | undefined;
}
export interface KnowledgeSearchBackend {
  search(input: SearchInput, signal?: AbortSignal): Promise<KnowledgeResult>;
  discard(kind: KnowledgeKind, memory: boolean, signal?: AbortSignal): Promise<void>;
}
export class KnowledgeSearch extends Context.Service<KnowledgeSearch, KnowledgeSearchOwner>()('concord/app/KnowledgeSearch') {}
interface FileObservation { readonly identity: string; readonly digest?: string; readonly bytes: number }
interface SourceObservation { readonly definition: string; readonly generation: KnowledgeGeneration; readonly files: ReadonlyMap<string, FileObservation> }
const mib = 1024 * 1024;
export function queryTerms(query: string): readonly string[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  if (!terms.length) throw new ConcordError('InvalidInput', 'recall/search query must be non-empty');
  return terms;
}
const rootFor = (kind: KnowledgeKind) => kind === 'memory' ? 'memory' : 'docs/issues';
function document(record: DocumentRecord): KnowledgeDocument {
  return { path: record.path, id: record.metadata.id, title: record.metadata.title, body: record.body, digest: record.digest,
    searchText: `${record.metadata.title}\n${record.body}`.toLocaleLowerCase(),
    ...(record.metadata.kind === 'issue' ? { provider: record.metadata.source?.provider ?? 'local' as const } : {}) };
}
function parse(path: string, source: string, kind: KnowledgeKind): KnowledgeDocument | undefined {
  const record = decodeUncachedDocumentSource(path, source);
  return record?.metadata.kind === kind && documentDisposition(kind, path, ['memory']) === 'current' ? document(record) : undefined;
}
const reply = (kind: KnowledgeKind, query: string, documents: readonly KnowledgeDocument[]): KnowledgeSearchReply => ({ operation: `${kind}-search`, query,
  documents: [...documents].sort((a, b) => a.path.localeCompare(b.path)).map(({ searchText: _searchText, ...value }) => value) });
const definition = () => objectDigest({ schema: 'concord.search/v1', parser: DOCUMENT_PARSER_VERSION, normalize: 'trim-localeLowerCase-split-js-whitespace-and-includes', bun: process.versions.bun, unicode: process.versions.unicode, locale: Intl.DateTimeFormat().resolvedOptions().locale });

/** The session retains source identities and byte counts, never another corpus of bodies. */
export function makeKnowledgeSearchOwner(backend: KnowledgeSearchBackend): KnowledgeSearchOwner {
  const observations = new Map<string, SourceObservation>(), semaphore = Semaphore.makeUnsafe(1);
  let diagnostic: string | undefined;
  const search = async (repo: Repository, kind: KnowledgeKind, query: string, signal?: AbortSignal): Promise<KnowledgeSearchReply> => {
    const terms = queryTerms(query), deadline = process.hrtime.bigint() + 600_000_000_000n;
    const check = () => { if (signal?.aborted || process.hrtime.bigint() >= deadline) throw new ConcordError('HawdbCancelled', 'Search was cancelled or exceeded its deadline'); };
    const discovered = repo.access === 'read' ? repo.fileIdentities?.(rootFor(kind)).filter(file => file.path.endsWith('.md')) : undefined;
    const files = discovered ?? repo.files(rootFor(kind)).filter(path => path.endsWith('.md')).map(path => ({ path, identity: '' }));
    const source = (file: { readonly path: string; readonly identity: string }) => {
      check();
      const text = discovered && repo.readIdentified ? repo.readIdentified(file.path, file.identity) : repo.read(file.path);
      if (text === undefined) throw new ConcordError('SourceChanged', `Search source disappeared: ${file.path}`);
      if (Buffer.byteLength(text) > 8 * mib) throw new HawdbFailure('HawdbLimit', 'Search source exceeds 8 MiB');
      return text;
    };
    if (Buffer.byteLength(query) > 64 * 1024 || new Set(terms).size > 256) throw new HawdbFailure('HawdbLimit', 'Search query exceeds its native budget');
    const attempt = async (memory: boolean): Promise<KnowledgeSearchReply> => {
      const key = `${repo.root}:${memory ? 'memory' : 'persistent'}:${kind}`, currentDefinition = definition();
      const remembered = observations.get(key), prior = discovered && remembered?.definition === currentDefinition ? remembered : undefined;
      const next = new Map<string, FileObservation>(), documents: KnowledgeDocument[] = [];
      let changedBytes = 0;
      try {
        for (const file of files) {
          check();
          const previous = prior?.files.get(file.path);
          if (previous?.identity === file.identity && file.identity !== '') { next.set(file.path, previous); continue; }
          const value = parse(file.path, source(file), kind);
          const bytes = value === undefined ? 0 : Buffer.byteLength(JSON.stringify(value));
          changedBytes += bytes;
          if (bytes > 8 * mib || changedBytes > 64 * mib) throw new HawdbFailure('HawdbLimit', 'Search changes exceed their input budget');
          next.set(file.path, { identity: file.identity, ...(value ? { digest: value.digest } : {}), bytes });
          if (value) documents.push(value);
        }
        const removed = [...(prior?.files ?? [])].filter(([path, value]) => value.digest !== undefined && next.get(path)?.digest === undefined).map(([path]) => path);
        const changed = !prior || documents.length > 0 || removed.length > 0;
        const entries = [...next].filter(([, value]) => value.digest !== undefined).sort(([a], [b]) => a.localeCompare(b));
        let generation: KnowledgeGeneration = changed ? { kind, generation: randomUUID(), definitionDigest: currentDefinition, sourceDigest: digest(JSON.stringify(entries.map(([path, value]) => [path, value.digest]))), documentCount: entries.length, logicalBytes: 0 } : prior.generation;
        if (changed) {
          const documentBytes = entries.reduce((n, [, value]) => n + value.bytes, 0);
          for (let i = 0; i < 4; i++) generation = { ...generation, logicalBytes: documentBytes + Buffer.byteLength(JSON.stringify(generation)) };
          if (entries.length > 20000 || generation.logicalBytes > 64 * mib) throw new HawdbFailure('HawdbLimit', 'Search collection exceeds its budget');
        }
        const result = Schema.decodeUnknownSync(KnowledgeResult, { onExcessProperty: 'error' })(await backend.search({ op: 'search', memory, kind, generation: generation.generation, terms: [...new Set(terms)], ...(changed ? { update: { generation, previous: prior?.generation.generation ?? null, documents, removed } } : {}) }, signal));
        check();
        if (result.generation.generation !== generation.generation || result.generation.sourceDigest !== generation.sourceDigest || result.generation.definitionDigest !== currentDefinition || result.documents.some(value => next.get(value.path)?.digest !== value.digest)) throw new HawdbFailure('HawdbIncompatible', 'Search result differs from observed sources');
        observations.set(key, { definition: currentDefinition, generation, files: next });
        return reply(kind, query, result.documents);
      } catch (cause) { observations.delete(key); throw cause; }
    };
    try { return await attempt(repo.persistentCache === 'off'); }
    catch (cause) {
      if (cause instanceof HawdbFailure) diagnostic = `${cause.code}: ${cause.message}`;
      throw cause;
    }
  };
  return { invalidate: () => { observations.clear(); }, get diagnostic() { return diagnostic; },
    search: async (repo, kind, query, signal) => {
      const result = await Effect.runPromise(Effect.result(semaphore.withPermit(Effect.tryPromise({ try: () => inRepositorySnapshot(repo, () => search(repo, kind, query, signal)), catch: cause => cause }))));
      if (result._tag === 'Failure') { observations.clear(); throw result.failure; }
      return result.success;
    },
  };
}

/** A standalone or cache-off call owns and drains its temporary memory Worker. */
export async function searchKnowledgeRecords(repo: Repository, kind: KnowledgeKind, query: string, owner?: KnowledgeSearchOwner, signal?: AbortSignal): Promise<KnowledgeSearchReply> {
  queryTerms(query);
  if (owner) return owner.search(repo, kind, query, signal);
  const worker = new DatabaseWorker();
  try {
    await worker.request({ op: 'open', privateDir: null, runtime: repositoryRuntime(repo) }, { signal });
    const temporary = makeKnowledgeSearchOwner({
      search: async (input, signal) => Schema.decodeUnknownSync(KnowledgeResult)(await worker.request({ ...input, memory: true }, { signal })),
      discard: async (kind, _memory, signal) => { await worker.request({ op: 'discard-search', kind, memory: true }, { signal }); },
    });
    return await temporary.search(repo, kind, query, signal);
  } finally { await worker.close(); }
}
