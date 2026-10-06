// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
import { Schema } from 'effect';
import { AnnotatedCaseSchema, ConcordError, DesignSchema, EngineeringSchema, FeatureSchema, IssueSchema, MemorySchema, ResearchSchema, RoadmapSchema, UseCaseSchema, digest } from './shared.js';
import { FeedbackSourceSchema } from './feedback-schema.js';
import { CodeDeclarationSchema } from './code.js';
import { readRepositoryFileSync } from './storage.js';
import { decodeDocumentSource } from './document-codec.js';
import { parseConstitution } from './constitution.js';

const sourceWithoutBody = Schema.Union(FeedbackSourceSchema.members.map(member => {
  const { body: _body, ...fields } = member.fields;
  return Schema.Struct(fields);
}));
const Issue = Schema.Struct({ ...IssueSchema.fields, source: Schema.optional(sourceWithoutBody) });
const Metadata = Schema.Union([FeatureSchema, UseCaseSchema, ResearchSchema, DesignSchema, RoadmapSchema, EngineeringSchema, MemorySchema, Issue]);
const Cache = Schema.Struct({ status: Schema.String, hits: Schema.Number, misses: Schema.Number, path: Schema.String, detail: Schema.optional(Schema.String) });
const Edge = Schema.Struct({ from: Schema.String, to: Schema.String, relation: Schema.String });
const Relationship = Schema.Literals(['code', 'test']);
const counts = Schema.Struct({ code: Schema.Number, test: Schema.Number });
export const TraceGapsValue = Schema.Struct({
  operation: Schema.Literal('trace-gaps'), semantics: Schema.Literal('missing-explicit-relationships-not-coverage'), limitations: Schema.Array(Schema.String),
  contracts: Schema.Array(Schema.Struct({ path: Schema.String, kind: Schema.Literals(['feature', 'use-case']), title: Schema.String, missing: Schema.Array(Relationship), relationships: counts })),
  cliPages: Schema.Array(Schema.Struct({ path: Schema.String, feature: Schema.String, title: Schema.String, missing: Schema.Array(Relationship), relationships: counts })),
  cache: Cache, codeCache: Schema.optional(Cache),
});
export const TraceShowValue = Schema.Struct({
  operation: Schema.Literal('trace-show'), subject: Schema.Struct({ path: Schema.String, metadata: Metadata, digest: Schema.String }),
  relatedPaths: Schema.Array(Schema.String), incoming: Schema.Array(Edge), outgoing: Schema.Array(Edge), tests: Schema.Array(AnnotatedCaseSchema),
  codeDeclarations: Schema.Array(Schema.Struct({ ...CodeDeclarationSchema.fields, matchedContracts: Schema.Array(Schema.String) })), cache: Cache,
});
export const ReviewRenderValue = Schema.Struct({ segments: Schema.Array(Schema.Union([
  Schema.Struct({ text: Schema.String }), Schema.Struct({ constitution: Schema.Struct({ path: Schema.String, digest: Schema.String }) }),
])) });
export type TraceGapsValue = typeof TraceGapsValue.Type;
export type TraceShowValue = typeof TraceShowValue.Type;
export type ReviewRenderValue = typeof ReviewRenderValue.Type;
export type QueryValue = TraceGapsValue | TraceShowValue | ReviewRenderValue;
export function queryValueSchema(query: readonly string[]) { return query[0] === 'review' ? ReviewRenderValue : query[1] === 'show' ? TraceShowValue : TraceGapsValue; }
export function stripQueryBodies(value: unknown): QueryValue {
  const projected = Schema.decodeUnknownSync(Schema.Union([TraceGapsValue, TraceShowValue, ReviewRenderValue]), { onExcessProperty: 'ignore' })(value);
  return projected;
}

/** Owner bodies are read through the repository's single standalone path guard. */
export function readQueryBody(root: string, path: string): string {
  const source = readRepositoryFileSync(root, path);
  if (source === undefined) throw new ConcordError('BodyUnavailable', `${path} no longer exists`);
  return source;
}
export function hydrateQueryValue(root: string, value: QueryValue, read = readQueryBody) {
  const bodyChanged: string[] = [], bodyUnavailable: { path: string; code: string }[] = [];
  const body = (path: string, expected: string, constitution: boolean) => {
    try {
      const source = read(root, path);
      if (digest(source) !== expected) { bodyChanged.push(path); return undefined; }
      const owner = constitution ? parseConstitution(source) : decodeDocumentSource(path, source);
      if (!owner) throw new ConcordError('InvalidData', 'Expected a Concord owner');
      return owner;
    } catch (cause) {
      bodyUnavailable.push({ path, code: cause instanceof ConcordError ? cause.code : (cause as NodeJS.ErrnoException).code ?? 'BodyUnavailable' });
      return undefined;
    }
  };
  const output = 'segments' in value ? { operation: 'cached-query', body: value.segments.map(segment => 'text' in segment ? segment.text : body(segment.constitution.path, segment.constitution.digest, true)?.body.trimEnd() ?? '(constitution changed since projection; use --fresh)').join('') }
    : value.operation === 'trace-show' ? (() => {
      const restored = body(value.subject.path, value.subject.digest, false);
      return { ...value, subject: restored === undefined ? value.subject : { path: value.subject.path, metadata: restored.metadata, body: restored.body, digest: value.subject.digest } };
    })() : value;
  return { value: output, bodyChanged: [...new Set(bodyChanged)].sort(), bodyUnavailable };
}
