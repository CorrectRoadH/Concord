// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#cli-查询
import { Effect, Schedule, Schema } from 'effect';
import type { QueryReply } from './query-port.js';
export { Queries, QueryReply } from './query-port.js';
import { ConcordError, failure, FeedbackFilterSchema } from '../model/index.js';
import { Workspace } from '../base/workspace/index.js';
import { Sources } from '../base/sources/index.js';
import { waitForPublication } from '../base/publication/index.js';
import { buildTrace, requireValidTrace, selectCase } from '../domain/trace/index.js';
import { loadDocuments, readDocumentReference, findDocument } from '../domain/documents/index.js';
import { constitutionShow } from '../domain/constitution/index.js';
import { showWriting, checkWriting, writingIndex } from '../domain/writing/index.js';
import { showConcepts, indexConcepts } from '../domain/concepts/index.js';
import { listFeedback } from '../domain/feedback/index.js';
import { readNativeObservations } from '../domain/tests/index.js';
import { scanCode } from '../domain/code/index.js';
import { checkCurrentProject } from './check-current.js';
import { knowledgeIndex, knowledgeRecall } from './knowledge.js';
import { listCode } from './code-commands.js';
import { showConfig } from './editing.js';
import { documentShow, traceShow, traceGaps, renderReview } from './trace-queries.js';
import { analysisView } from './analysis-view.js';
import { Query, cachedQuery } from './query-cache.js';
import { getWorkspaceSnapshot } from './application.js';

const strict = <S extends Schema.Top>(schema: S): S['Rebuild'] => schema.annotate({ parseOptions: { onExcessProperty: 'error' } });
const operation = <const N extends string, F extends Schema.Struct.Fields>(name: N, fields: F) => strict(Schema.Struct({ name: Schema.Literal(name), input: strict(Schema.Struct(fields)) }));
const empty = <const N extends string>(name: N) => operation(name, {});
const DocumentKindSchema = Schema.Literals(['feature', 'use-case', 'research', 'design', 'roadmap', 'engineering', 'issue', 'memory']);
export const QueryRequest = Schema.Union([
  empty('check'),
  empty('trace.check'), operation('trace.show', { reference: Schema.String }), empty('trace.gaps'),
  operation('review', { reference: Schema.optional(Schema.String) }),
  operation('docs.check', { path: Schema.optional(Schema.String) }),
  empty('constitution.show'), empty('config.show'),
  empty('workspace.show'),
  operation('documents.list', { kind: Schema.optional(DocumentKindSchema) }),
  operation('documents.show', { id: Schema.String, kind: Schema.optional(DocumentKindSchema) }),
  empty('memory.index'), operation('memory.recall', { query: Schema.String }), operation('issue.recall', { query: Schema.String }),
  empty('code.list'), empty('test.list'), operation('test.show', { id: Schema.String }),
  operation('writing.show', { path: Schema.optional(Schema.String) }), empty('writing.index'),
  operation('concepts.show', { path: Schema.optional(Schema.String) }), empty('concepts.index'),
  operation('feedback.list', { filter: Schema.optional(FeedbackFilterSchema) }),
  operation('feedback.show', { id: Schema.String }), empty('feedback.connection.list'),
  operation('historical', { query: Query }),
]);
export type QueryRequest = typeof QueryRequest.Type;

const queryValue = (repo: import('../base/workspace/index.js').LocalRepository, request: QueryRequest, cache: 'use' | 'off'): unknown => {
  switch (request.name) {
    case 'trace.check': { const t = buildTrace(repo, cache); return { operation: 'trace-check', ok: t.complete, complete: t.complete, findings: t.findings, edges: t.edges }; }
    case 'trace.show': return traceShow(repo, request.input.reference, cache);
    case 'trace.gaps': return traceGaps(repo, cache);
    case 'review': return renderReview(repo, request.input.reference, cache);
    case 'constitution.show': return constitutionShow(repo);
    case 'config.show': return { ...showConfig(repo), path: repo.configSnapshot.path, source: repo.configSnapshot.source };
    case 'docs.check': return checkWriting(repo, request.input.path, cache !== 'off');
    case 'documents.list': {
      const { kind } = request.input;
      return { operation: 'list', documents: loadDocuments(repo, kind === undefined ? undefined : [kind]).map(doc => ({ path: doc.path, ...doc.metadata })) };
    }
    case 'documents.show': {
      const { id, kind } = request.input;
      const selected = id.includes('/') ? readDocumentReference(repo, id) : findDocument(loadDocuments(repo), id);
      return { ...documentShow(repo, id, kind ?? selected.metadata.kind, cache), operation: 'show' };
    }
    case 'memory.index': return knowledgeIndex(repo, 'memory');
    case 'memory.recall': return knowledgeRecall(repo, 'memory', request.input.query);
    case 'issue.recall': return knowledgeRecall(repo, 'issue', request.input.query);
    case 'code.list': return listCode(repo);
    case 'test.list': { const t = buildTrace(repo, cache, { includeCode: false }); requireValidTrace(t); return { operation: 'test-list', cases: t.annotations.cases, cache: t.annotations.cache, observations: readNativeObservations(repo) }; }
    case 'test.show': {
      const t = buildTrace(repo, cache, { includeCode: false }); requireValidTrace(t);
      const selected = selectCase(t.annotations.cases, request.input.id);
      let codes: ReturnType<typeof scanCode>['codes'] = [];
      try { codes = scanCode(repo, { cache: 'off' }).codes; } catch { /* Optional observations. */ }
      return { operation: 'test-show', case: selected, evidenceScope: 'command', analysis: analysisView(repo, [selected], codes, t.documents), observations: readNativeObservations(repo) };
    }
    case 'writing.show': return showWriting(repo, request.input.path);
    case 'writing.index': return writingIndex(repo);
    case 'concepts.show': return showConcepts(repo, request.input.path);
    case 'concepts.index': return indexConcepts(repo);
    case 'feedback.list': return { operation: 'feedback-list', feedback: listFeedback(repo, undefined, request.input.filter) };
    case 'feedback.show': {
      const item = listFeedback(repo).find(candidate => candidate.document.metadata.id === request.input.id);
      if (!item) throw new ConcordError('DocumentNotFound', `No feedback matches ${request.input.id}`);
      const relations = documentShow(repo, item.document.path, 'issue', cache);
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
      return yield* sources.snapshot(repo, Effect.try({ try: () => queryValue(repo, request, cache), catch: failure }));
    })).pipe(Effect.retry({ times: 2, schedule: Schedule.spaced('50 millis'), while: error => error.code === 'SourceChanged' || error.code === 'FileChangedSinceRead' && error.details === 'source-observation' }));
  return yield* Effect.try({ try: () => {
    const json = Schema.decodeUnknownSync(Schema.Json)(JSON.parse(JSON.stringify(value)));
    const failed = ['check', 'trace.check', 'docs.check'].includes(request.name) && typeof value === 'object' && value !== null && 'ok' in value && value.ok === false;
    return { value: json, exitCode: failed ? 1 : 0 } satisfies QueryReply;
  }, catch: failure });
});
