// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#cli-查询
import type * as WorkspaceTypes from '../base/workspace/index.ts';
import { Effect, Schedule, Schema } from 'effect';
import type { QueryReply } from './query-port.ts';
export { Queries, QueryReply } from './query-port.ts';
import { ConcordError, failure, FeedbackFilterSchema } from '../model/index.ts';
import { Workspace } from '../base/workspace/index.ts';
import { Sources } from '../base/sources/index.ts';
import { waitForPublication } from '../base/publication/index.ts';
import { buildTrace, requireValidTrace, selectCase } from '../domain/trace/index.ts';
import { diagnoseDocuments, loadDocuments, readDocumentReference, findDocument } from '../domain/documents/index.ts';
import { tasteShow } from '../domain/taste/index.ts';
import { showWriting, checkWriting, writingIndex } from '../domain/writing/index.ts';
import { showConcepts, indexConcepts } from '../domain/concepts/index.ts';
import { listFeedback } from '../domain/feedback/index.ts';
import { nativeBindings, readNativeObservations } from '../domain/tests/index.ts';
import { scanCode } from '../domain/code/index.ts';
import { checkCurrentProject } from './check-current.ts';
import { knowledgeIndex, knowledgeSearchRecords } from './knowledge.ts';
import { KnowledgeSearch, type KnowledgeSearchOwner } from './knowledge-search.ts';
import { listCode } from './code-commands.ts';
import { showConfig } from './editing.ts';
import { documentShow, traceShow, traceGaps, renderReview } from './trace-queries.ts';
import { analysisView } from './analysis-view.ts';
import { Query, cachedQuery } from './query-cache.ts';
import { getWorkspaceSnapshot } from './application.ts';

const strict = <S extends Schema.Top>(schema: S): S['Rebuild'] => schema.annotate({ parseOptions: { onExcessProperty: 'error' } });
const operation = <const N extends string, F extends Schema.Struct.Fields>(name: N, fields: F) => strict(Schema.Struct({ name: Schema.Literal(name), input: strict(Schema.Struct(fields)) }));
const empty = <const N extends string>(name: N) => operation(name, {});
const DocumentKindSchema = Schema.Literals(['feature', 'use-case', 'design', 'roadmap', 'engineering', 'issue', 'memory']);
export const QueryRequest = Schema.Union([
  empty('check'),
  empty('trace.check'), operation('trace.show', { reference: Schema.String }), empty('trace.gaps'),
  operation('review', { reference: Schema.optional(Schema.String) }),
  empty('docs.check'),
  empty('taste'), empty('config.show'),
  empty('workspace.show'),
  operation('documents.list', { kind: Schema.optional(DocumentKindSchema) }),
  operation('documents.show', { id: Schema.String, kind: Schema.optional(DocumentKindSchema) }),
  empty('memory.index'), operation('memory.search', { query: Schema.String }), operation('issue.search', { query: Schema.String }),
  empty('code.list'), empty('test.list'), operation('test.show', { id: Schema.String }),
  operation('writing.show', { path: Schema.optional(Schema.String) }), empty('writing.index'),
  operation('concepts.show', { path: Schema.optional(Schema.String) }), empty('concepts.index'),
  operation('feedback.list', { filter: Schema.optional(FeedbackFilterSchema) }),
  operation('feedback.show', { id: Schema.String }), empty('feedback.connection.list'),
  operation('historical', { query: Query }),
]);
export type QueryRequest = typeof QueryRequest.Type;

const queryValue = async (repo: WorkspaceTypes.LocalRepository, request: QueryRequest, cache: 'use' | 'off', searchOwner?: KnowledgeSearchOwner, signal?: AbortSignal): Promise<unknown> => {
  switch (request.name) {
    case 'trace.check': { const t = (await buildTrace(repo, cache)); return { operation: 'trace-check', ok: t.complete, complete: t.complete, findings: t.findings, edges: t.edges }; }
    case 'trace.show': return (await traceShow(repo, request.input.reference, cache));
    case 'trace.gaps': return (await traceGaps(repo, cache));
    case 'review': return (await renderReview(repo, request.input.reference, cache));
    case 'taste': return tasteShow(repo);
    case 'config.show': return { ...showConfig(repo), path: repo.configSnapshot.path, source: repo.configSnapshot.source };
    case 'docs.check': return checkWriting(repo, undefined, cache !== 'off');
    case 'documents.list': {
      const { kind } = request.input;
      if (kind === 'memory' || kind === 'issue') return { ...knowledgeIndex(repo, kind), operation: 'list' };
      const inventory = diagnoseDocuments(repo, kind === undefined ? undefined : [kind]);
      return { operation: 'list', documents: inventory.documents.map(doc => ({ path: doc.path, ...doc.metadata })), complete: inventory.complete, findings: inventory.findings };
    }
    case 'documents.show': {
      const { id, kind } = request.input;
      const selected = id.includes('/') ? readDocumentReference(repo, id) : findDocument(loadDocuments(repo), id);
      return { ...(await documentShow(repo, id, kind ?? selected.metadata.kind, cache)), operation: 'show' };
    }
    case 'memory.index': return knowledgeIndex(repo, 'memory');
    case 'memory.search': return knowledgeSearchRecords(repo, 'memory', request.input.query, searchOwner, signal);
    case 'issue.search': return knowledgeSearchRecords(repo, 'issue', request.input.query, searchOwner, signal);
    case 'code.list': return (await listCode(repo));
    case 'test.list': { const t = (await buildTrace(repo, cache, { includeCode: false })); requireValidTrace(t); const observations = readNativeObservations(repo); return { operation: 'test-list', cases: t.annotations.cases, cache: t.annotations.cache, observations, bindings: nativeBindings(repo, t.annotations.cases, observations) }; }
    case 'test.show': {
      const t = (await buildTrace(repo, cache, { includeCode: false })); requireValidTrace(t);
      const selected = selectCase(t.annotations.cases, request.input.id);
      let codes: Awaited<ReturnType<typeof scanCode>>['codes'] = [];
      try { codes = (await scanCode(repo, { cache: 'off' })).codes; } catch { /* Optional observations. */ }
      const observations = readNativeObservations(repo);
      return { operation: 'test-show', case: selected, analysis: (await analysisView(repo, [selected], codes, t.documents)), observations, bindings: nativeBindings(repo, [selected], observations) };
    }
    case 'writing.show': return showWriting(repo, request.input.path);
    case 'writing.index': return writingIndex(repo);
    case 'concepts.show': return showConcepts(repo, request.input.path);
    case 'concepts.index': return indexConcepts(repo);
    case 'feedback.list': return { operation: 'feedback-list', feedback: listFeedback(repo, undefined, request.input.filter) };
    case 'feedback.show': {
      const reference = request.input.id.includes('/') ? request.input.id : `docs/issues/${request.input.id}.md`;
      const selected = readDocumentReference(repo, reference, ['issue']);
      const item = listFeedback(repo, [selected])[0]!;
      const relations = (await documentShow(repo, item.document.path, 'issue', cache));
      return { operation: 'feedback-show', feedback: { ...item, document: relations.document }, incoming: relations.incoming, outgoing: relations.outgoing, complete: relations.complete, findings: relations.findings };
    }
    case 'feedback.connection.list': return { operation: 'feedback-connection-list', connections: repo.config.feedbackConnections ?? [] };
    case 'check': throw new ConcordError('InvalidInput', 'Check requires its Effect operation');
    case 'workspace.show': throw new ConcordError('InvalidInput', 'Workspace inspection requires its Effect operation');
    case 'historical': throw new ConcordError('InvalidInput', 'Historical queries require their Effect operation');
  }
};
export const executeQuery = Effect.fn('Queries.Local.execute')(function*(root: string | undefined, input: QueryRequest, cache: 'use' | 'off' = 'use') {
  const request = yield* Schema.decodeUnknownEffect(QueryRequest, { onExcessProperty: 'error' })(input).pipe(Effect.mapError(failure));
  const value = yield* request.name === 'historical' ? cachedQuery(root, request.input.query) : request.name === 'workspace.show' ? Effect.gen(function*() {
    const location = yield* (yield* Workspace).locate(root, true);
    return yield* getWorkspaceSnapshot(location.root, cache);
  }) : request.name === 'check'
    ? checkCurrentProject(root, cache)
    : Effect.scoped(Effect.gen(function*() {
      const workspace = yield* Workspace;
      const sources = yield* Sources;
      const repo = yield* waitForPublication(reclaimPublication => workspace.openRead(root, { access: 'read', optimistic: true, persistentCache: cache, reclaimPublication }));
      const owner = yield* Effect.serviceOption(KnowledgeSearch);
      const searchOwner = owner._tag === 'Some' ? owner.value : undefined;
      let pending: Promise<unknown> | undefined;
      const operation = Effect.tryPromise({ try: signal => pending = queryValue(repo, request, cache, searchOwner, signal), catch: failure });
      const search = request.name === 'memory.search' || request.name === 'issue.search';
      // Abort reaches the Worker immediately; retain the source scope until it drains.
      const evaluate = search ? operation.pipe(Effect.ensuring(Effect.promise(async () => { await pending?.then(() => undefined, () => undefined); }))) : operation.pipe(Effect.uninterruptible);
      return yield* sources.snapshot(repo, evaluate);
    })).pipe(Effect.retry({ times: 2, schedule: Schedule.spaced('50 millis'), while: error => error.code === 'SourceChanged' || error.code === 'FileChangedSinceRead' && error.details === 'source-observation' }));
  return yield* Effect.try({ try: () => {
    const json = Schema.decodeUnknownSync(Schema.Json)(JSON.parse(JSON.stringify(value)));
    const failed = ['check', 'trace.check', 'docs.check'].includes(request.name) && typeof value === 'object' && value !== null && 'ok' in value && value.ok === false;
    return { value: json, exitCode: failed ? 1 : 0 } satisfies QueryReply;
  }, catch: failure });
});
