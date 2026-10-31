// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#cli-查询
import { Context, Effect, Layer, Schema } from 'effect';
import { ConcordError, failure } from '../model/index.js';
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

const strict = <S extends Schema.Top>(schema: S): S['Rebuild'] => schema.annotate({ parseOptions: { onExcessProperty: 'error' } });
const operation = <const N extends string, F extends Schema.Struct.Fields>(name: N, fields: F) => strict(Schema.Struct({ name: Schema.Literal(name), input: strict(Schema.Struct(fields)) }));
const empty = <const N extends string>(name: N) => operation(name, {});
const DocumentKindSchema = Schema.Literals(['feature', 'use-case', 'research', 'design', 'roadmap', 'engineering', 'issue', 'memory']);
export const QueryRequest = Schema.Union([
  empty('check'),
  empty('trace.check'), operation('trace.show', { reference: Schema.String }), empty('trace.gaps'),
  operation('review.render', { reference: Schema.optional(Schema.String) }),
  operation('docs.check', { path: Schema.optional(Schema.String) }),
  empty('constitution.show'), empty('config.show'),
  operation('documents.list', { kind: Schema.optional(DocumentKindSchema), open: Schema.Boolean }),
  operation('documents.show', { id: Schema.String, kind: Schema.optional(DocumentKindSchema) }),
  empty('memory.index'), operation('memory.recall', { query: Schema.String }), operation('issue.recall', { query: Schema.String }),
  empty('code.list'), empty('test.list'), operation('test.show', { id: Schema.String }),
  operation('writing.show', { path: Schema.optional(Schema.String) }), empty('writing.index'),
  operation('concepts.show', { path: Schema.optional(Schema.String) }), empty('concepts.index'),
  empty('feedback.list'),
]);
export type QueryRequest = typeof QueryRequest.Type;
export const QueryReply = strict(Schema.Struct({ value: Schema.Json, exitCode: Schema.Literals([0, 1]) }));
export type QueryReply = typeof QueryReply.Type;

const queryValue = (repo: import('../base/workspace/index.js').LocalRepository, request: QueryRequest): unknown => {
  switch (request.name) {
    case 'trace.check': { const t = buildTrace(repo); return { operation: 'trace-check', ok: t.complete, complete: t.complete, findings: t.findings, edges: t.edges }; }
    case 'trace.show': return traceShow(repo, request.input.reference);
    case 'trace.gaps': return traceGaps(repo);
    case 'review.render': return { operation: 'review-render', markdown: renderReview(repo, request.input.reference) };
    case 'constitution.show': return constitutionShow(repo);
    case 'config.show': return { ...showConfig(repo), path: repo.configSnapshot.path, source: repo.configSnapshot.source };
    case 'docs.check': return checkWriting(repo, request.input.path);
    case 'documents.list': {
      const { kind, open } = request.input;
      if (open && kind !== undefined && kind !== 'issue') throw new ConcordError('InvalidOption', '--open applies to Issues');
      return { operation: 'list', documents: loadDocuments(repo, open ? ['issue'] : kind === undefined ? undefined : [kind]).filter(doc => !open || doc.metadata.kind === 'issue' && doc.metadata.status !== 'closed').map(doc => ({ path: doc.path, ...doc.metadata })) };
    }
    case 'documents.show': {
      const { id, kind } = request.input;
      const selected = id.includes('/') ? readDocumentReference(repo, id) : findDocument(loadDocuments(repo), id);
      return { ...documentShow(repo, id, kind ?? selected.metadata.kind), operation: 'show' };
    }
    case 'memory.index': return knowledgeIndex(repo, 'memory');
    case 'memory.recall': return knowledgeRecall(repo, 'memory', request.input.query);
    case 'issue.recall': return knowledgeRecall(repo, 'issue', request.input.query);
    case 'code.list': return listCode(repo);
    case 'test.list': { const t = buildTrace(repo, 'use', { includeCode: false }); requireValidTrace(t); return { operation: 'test-list', cases: t.annotations.cases, cache: t.annotations.cache, observations: readNativeObservations(repo) }; }
    case 'test.show': {
      const t = buildTrace(repo, 'use', { includeCode: false }); requireValidTrace(t);
      const selected = selectCase(t.annotations.cases, request.input.id);
      let codes: ReturnType<typeof scanCode>['codes'] = [];
      try { codes = scanCode(repo, { cache: 'off' }).codes; } catch { /* Optional observations. */ }
      return { operation: 'test-show', case: selected, evidenceScope: 'command', analysis: analysisView(repo, [selected], codes, t.documents), observations: readNativeObservations(repo) };
    }
    case 'writing.show': return showWriting(repo, request.input.path);
    case 'writing.index': return writingIndex(repo);
    case 'concepts.show': return showConcepts(repo, request.input.path);
    case 'concepts.index': return indexConcepts(repo);
    case 'feedback.list': return { operation: 'feedback-list', feedback: listFeedback(repo) };
    case 'check': throw new ConcordError('InvalidInput', 'Check requires its Effect operation');
  }
};
export const executeQuery = Effect.fn('Queries.Local.execute')(function*(root: string | undefined, input: QueryRequest, cache: 'use' | 'off' = 'use') {
  const request = yield* Schema.decodeUnknownEffect(QueryRequest, { onExcessProperty: 'error' })(input).pipe(Effect.mapError(failure));
  const value = yield* request.name === 'check'
    ? checkCurrentProject(root, cache)
    : Effect.scoped(Effect.gen(function*() {
      const workspace = yield* Workspace;
      const sources = yield* Sources;
      const repo = yield* waitForPublication(reclaimPublication => workspace.openRead(root, { access: 'read', optimistic: true, persistentCache: cache, reclaimPublication }));
      return yield* sources.snapshot(repo, Effect.try({ try: () => queryValue(repo, request), catch: failure }));
    }));
  return yield* Effect.try({ try: () => {
    const json = Schema.decodeUnknownSync(Schema.Json)(JSON.parse(JSON.stringify(value)));
    const failed = ['check', 'trace.check', 'docs.check'].includes(request.name) && typeof value === 'object' && value !== null && 'ok' in value && value.ok === false;
    return { value: json, exitCode: failed ? 1 : 0 } satisfies QueryReply;
  }, catch: failure });
});
export class Queries extends Context.Service<Queries, {
  readonly execute: typeof executeQuery;
}>()('concord/app/Queries') {
  static readonly Local = Layer.succeed(Queries, Queries.of({ execute: executeQuery }));
}
