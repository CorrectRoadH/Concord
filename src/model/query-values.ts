import { Schema } from "effect";
import { AnnotatedCaseSchema, DesignSchema, EngineeringSchema, FeatureSchema, IssueSchema, MemorySchema, RoadmapSchema, UseCaseSchema } from "./shared.ts";
import { FeedbackSourceSchema } from "./feedback-schema.ts";
import { CodeDeclarationSchema } from "./code-declaration.ts";
import { AnalysisViewSchema, TestRelevanceSchema } from "./analysis-view.ts";

const sourceWithoutBody = Schema.Union(FeedbackSourceSchema.members.map(member => {
  const { body: _body, ...fields } = member.fields;
  return Schema.Struct(fields);
}));
const Issue = Schema.Struct({ ...IssueSchema.fields, source: Schema.optional(sourceWithoutBody) });
const Metadata = Schema.Union([FeatureSchema, UseCaseSchema, DesignSchema, RoadmapSchema, EngineeringSchema, MemorySchema, Issue]);
const Cache = Schema.Struct({ status: Schema.String, hits: Schema.Number, misses: Schema.Number, path: Schema.String, detail: Schema.optional(Schema.String) });
const Edge = Schema.Struct({ from: Schema.String, to: Schema.String, relation: Schema.String });
const Relationship = Schema.Literals(['code', 'test']);
const counts = Schema.Struct({ code: Schema.Number, test: Schema.Number });
const RootOrderedList = Schema.Struct({ ordinal: Schema.Int, line: Schema.Int, endLine: Schema.Int, items: Schema.Int, marked: Schema.Int });
const StepRelationships = Schema.Struct({ ref: Schema.String, tests: Schema.Array(AnnotatedCaseSchema), codeDeclarations: Schema.Array(CodeDeclarationSchema), relevance: Schema.Array(TestRelevanceSchema) });
const StepGroup = Schema.Struct({
  path: Schema.String,
  steps: Schema.Array(Schema.Struct({ id: Schema.String, ordinal: Schema.Int, line: Schema.Int, endLine: Schema.Int, listOrdinal: Schema.Int, ...StepRelationships.fields, testCount: Schema.Int, codeCount: Schema.Int })),
  lists: Schema.Array(RootOrderedList), wholeUseCase: StepRelationships, nonStepAnchors: Schema.Array(StepRelationships), unassociatedSteps: Schema.Array(Schema.String),
  observation: Schema.Struct({ result: Schema.Literals(['observed', 'not-observed']), gaps: Schema.Array(Schema.String) }),
});
export const TraceGapsValue = Schema.Struct({
  operation: Schema.Literal('trace-gaps'), semantics: Schema.Literal('missing-explicit-relationships-not-coverage'), limitations: Schema.Array(Schema.String),
  contracts: Schema.Array(Schema.Struct({ path: Schema.String, kind: Schema.Literals(['feature', 'use-case']), title: Schema.String, missing: Schema.Array(Relationship), relationships: counts })),
  cliPages: Schema.Array(Schema.Struct({ path: Schema.String, feature: Schema.String, title: Schema.String, missing: Schema.Array(Relationship), relationships: counts })),
  unmarkedLists: Schema.Array(Schema.Struct({ path: Schema.String, lists: Schema.Array(RootOrderedList) })),
  cache: Cache, codeCache: Schema.optional(Cache),
});
export const TraceShowValue = Schema.Struct({
  operation: Schema.Literal('trace-show'), subject: Schema.Struct({ path: Schema.String, metadata: Metadata, digest: Schema.String }),
  relatedPaths: Schema.Array(Schema.String), incoming: Schema.Array(Edge), outgoing: Schema.Array(Edge), tests: Schema.Array(AnnotatedCaseSchema),
  codeDeclarations: Schema.Array(Schema.Struct({ ...CodeDeclarationSchema.fields, matchedContracts: Schema.Array(Schema.String) })), stepGroups: Schema.Array(StepGroup), cache: Cache,
  analysis: Schema.optional(AnalysisViewSchema),
});
export const ReviewRenderValue = Schema.Struct({ segments: Schema.Array(Schema.Union([
  Schema.Struct({ text: Schema.String }), Schema.Struct({ taste: Schema.Struct({ path: Schema.String, digest: Schema.String }) }),
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
