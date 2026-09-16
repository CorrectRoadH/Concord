// @concord-file shared-domain-contracts
// @concord-implements docs/feature/local-sdlc/README.md
import { createHash } from 'node:crypto';
import { Schema } from 'effect';
import { FeedbackConnectionsSchema, FeedbackSourceSchema } from './feedback-schema.js';
export * from './feedback-schema.js';
export { TEST_REFERENCE_VERSION, deriveTestReference } from './test-reference.js';

export class ConcordError extends Error {
  readonly name = 'ConcordError';
  constructor(readonly code: string, message: string, readonly details?: unknown) { super(message); }
}
export function failure(cause: unknown): ConcordError {
  return cause instanceof ConcordError ? cause : new ConcordError('OperationFailed', cause instanceof Error ? cause.message : String(cause));
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export const digest = (value: string | Uint8Array): string => `sha256:${createHash('sha256').update(value).digest('hex')}`;
export const objectDigest = (value: unknown): string => digest(canonical(value));
export function decode<A>(schema: Schema.ConstraintDecoder<A, never>, value: unknown, source: string): A {
  try { return Schema.decodeUnknownSync(schema, { onExcessProperty: 'error', errors: 'all' })(value); }
  catch (cause) { throw new ConcordError('InvalidData', `${source}: ${cause instanceof Error ? cause.message : String(cause)}`); }
}
export const Text = Schema.String.check(Schema.isMinLength(1));
export const Slug = Schema.String.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/));
export function slug(value: string): string { return decode(Slug, value, 'identifier'); }
export const Nat = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const Strings = Schema.Array(Text);
export const RunnerSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('node-test'), sourceFiles: Strings, timeoutMs: Schema.Int.check(Schema.isBetween({minimum: 1, maximum: 3600000})) }),
  Schema.Struct({ kind: Schema.Literal('command'), argv: Schema.NonEmptyArray(Text), sourceFiles: Strings, timeoutMs: Schema.Int.check(Schema.isBetween({minimum: 1, maximum: 3600000})) }),
]);
export type Runner = typeof RunnerSchema.Type;
export const TemplatePageSchema = Schema.Literals(['library', 'cli', 'architecture', 'lifecycle', 'use-case']);
export const MemorySourceSchema = Schema.Struct({
  name: Slug,
  provider: Schema.Literal('local-files'),
  path: Text,
  access: Schema.Literals(['read-only', 'read-write']),
  defaultWrite: Schema.optional(Schema.Boolean),
});
export const DocumentDefaultsSchema = Schema.Struct({
  featurePages: Schema.Array(TemplatePageSchema),
  roadmapPages: Schema.Array(TemplatePageSchema),
  designPages: Schema.Array(TemplatePageSchema),
});
export const ProjectSchema = Schema.Struct({
  format: Schema.Literal('concord.project/v1'),
  projectId: Text,
  testRoots: Schema.Array(Text),
  sourceRoots: Schema.optional(Schema.Array(Text)),
  runner: RunnerSchema,
  feedbackConnections: Schema.optional(FeedbackConnectionsSchema),
  projectTypes: Schema.optional(Schema.Array(Schema.Literals(['library', 'cli']))),
  documentDefaults: Schema.optional(DocumentDefaultsSchema),
  constitution: Schema.optional(Schema.Struct({ path: Schema.Literal('docs/constitution.md') })),
  memorySources: Schema.optional(Schema.NonEmptyArray(MemorySourceSchema)),
});
export type ProjectConfig = typeof ProjectSchema.Type;
export type MemorySource = typeof MemorySourceSchema.Type;
export interface ConfigSnapshot { readonly path: 'concord.config.ts'; readonly source: string; readonly digest: string; readonly config: ProjectConfig }

export interface Change { readonly path: string; readonly before: string | null; readonly after: string | null }
export interface MutationReceipt { readonly operation: string; readonly dryRun: boolean; readonly changedPaths: readonly string[]; readonly recoveryRequired?: boolean }
export interface Repository {
  readonly root: string;
  readonly privateDir: string;
  readonly config: ProjectConfig;
  readonly configSnapshot: ConfigSnapshot;
  read(path: string): string | undefined;
  files(prefix: string): string[];
  absolute(path: string): string;
  publish(operation: string, changes: readonly Change[], dryRun?: boolean): MutationReceipt;
}

export const Sha256 = Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/));
export const ContentHash = Schema.String.check(Schema.isPattern(/^(?:sha256:)?[0-9a-f]{64}$/));
export const GitCommit = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/));
export const SourceRecordSchema = Schema.Struct({ path: Text, commit: GitCommit, digest: Sha256 });
export const EvidenceFileSchema = Schema.Struct({ path: Text, digest: Sha256 });
export const RepositoryCaseEvidenceSchema = Schema.Struct({
  selector: Text, caseId: Text,
  binding: Schema.Struct({ kind: Schema.Literal('direct-contract'), contractRef: Text, contractSha256: ContentHash }),
  sourceDigest: ContentHash, candidateSha256: ContentHash,
  red: EvidenceFileSchema, green: EvidenceFileSchema, certificate: EvidenceFileSchema, inventory: EvidenceFileSchema,
  reliability: Schema.Array(EvidenceFileSchema).check(Schema.makeFilter(
    values => values.length === 6 && new Set(values.map(value => value.path)).size === 6,
    { description: 'six distinct reliability receipt paths' },
  )),
  invocationIds: Schema.NonEmptyArray(Text).check(Schema.makeFilter(
    values => values.length === 8 && new Set(values).size === 8,
    { description: 'distinct red, green and six reliability invocation identities' },
  )),
});
export const RepositoryEvidenceSchema = Schema.Struct({
  memory: Text, epoch: Nat, validatedAt: Text, cases: Schema.NonEmptyArray(RepositoryCaseEvidenceSchema),
});
export type RepositoryEvidence = typeof RepositoryEvidenceSchema.Type;
const resolution = { reason: Text, at: Text, epoch: Nat };
export const ResolutionSchema = Schema.Union([
  Schema.Struct({ ...resolution, kind: Schema.Literal('fixed'), evidenceLevel: Schema.Literal('command'), red: Text, green: Text, selectedCaseId: Text }),
  Schema.Struct({ ...resolution, kind: Schema.Literals(['not-a-bug', 'wont-fix', 'external-fixed']), evidenceLevel: Schema.Literal('author') }),
  Schema.Struct({ ...resolution, kind: Schema.Literals(['fixed', 'not-a-bug', 'wont-fix', 'external-fixed']), evidenceLevel: Schema.Literal('attested'),
    attestation: Schema.Struct({ statement: Text, proof: Strings, source: SourceRecordSchema, eventAt: Schema.optional(Text) }) }),
  Schema.Struct({ ...resolution, kind: Schema.Literal('fixed'), evidenceLevel: Schema.Literal('repository'), repositoryEvidence: RepositoryEvidenceSchema }),
]);
export type Resolution = typeof ResolutionSchema.Type;
export const HistorySchema = Schema.Struct({ at: Text, action: Text, reason: Text, ref: Schema.optional(Text), resolution: Schema.optional(ResolutionSchema), commit: Schema.optional(GitCommit), source: Schema.optional(SourceRecordSchema), eventAt: Schema.optional(Text) });
export type HistoryEntry = typeof HistorySchema.Type;
const base = { format: Schema.Literal('concord.document/v1'), id: Slug, title: Text, createdAt: Text,
  createdAtSource: Schema.optional(Schema.Struct({ kind: Schema.Literal('first-recorded'), path: Text, commit: GitCommit })),
  description: Schema.optional(Text),
};
export const FeatureSchema = Schema.Struct({ ...base, kind: Schema.Literal('feature'), origin: Schema.optional(Text), constitutionRefs: Schema.optional(Strings) });
export const UseCaseSchema = Schema.Struct({ ...base, kind: Schema.Literal('use-case'), feature: Text });
export const ResearchSchema = Schema.Struct({ ...base, kind: Schema.Literal('research'), observedAt: Schema.optional(Text), sources: Strings });
export const HistoricalDispositionSchema = Schema.Struct({ reason: Text, source: SourceRecordSchema, eventAt: Schema.optional(Text) });
export const DesignSchema = Schema.Struct({ ...base, kind: Schema.Literal('design'), alternatives: Schema.NonEmptyArray(Slug), constitutionRefs: Schema.optional(Strings), decision: Schema.optional(Schema.Struct({ selected: Slug, reason: Text, at: Schema.optional(Text), targets: Strings, source: Schema.optional(SourceRecordSchema) })), deferral: Schema.optional(HistoricalDispositionSchema) });
export const RoadmapSchema = Schema.Struct({ ...base, kind: Schema.Literal('roadmap'), state: Schema.Literals(['planned', 'adopted', 'cancelled']), adoptedAs: Schema.optional(Text), cancellation: Schema.optional(HistoricalDispositionSchema) });
export const EngineeringSchema = Schema.Struct({ ...base, kind: Schema.Literal('engineering') });
export const MemorySchema = Schema.Struct({ ...base, kind: Schema.Literal('memory'), memoryKind: Schema.Literals(['problem', 'decision', 'insight', 'note']), state: Schema.Literals(['captured', 'open', 'resolved', 'current', 'superseded']), epoch: Nat, promotions: Strings, history: Schema.Array(HistorySchema), resolution: Schema.optional(ResolutionSchema), supersededBy: Schema.optional(Text), supersession: Schema.optional(Schema.Struct({ statement: Text, source: SourceRecordSchema })) });
export type MemoryMeta = typeof MemorySchema.Type;
export const MEMORY_RELATION_KINDS = ['investigation', 'root-cause', 'decision', 'delivery'] as const;
export const IssueMemoryRelationSchema = Schema.Struct({ kind: Schema.Literals(MEMORY_RELATION_KINDS), memory: Text });
export type IssueMemoryRelation = typeof IssueMemoryRelationSchema.Type;
export const IssueAdoptionsSchema = Schema.Struct({ current: Strings, history: Schema.Array(Schema.Struct({ target: Text, commit: GitCommit })) });
export const IssueClosureSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('fixed'), memory: Text, proof: Schema.NonEmptyArray(Text) }),
  Schema.Struct({ kind: Schema.Literal('delivered'), memory: Text, target: Text, proof: Schema.NonEmptyArray(Text) }),
  Schema.Struct({ kind: Schema.Literal('duplicate'), canonical: Text }),
  Schema.Struct({ kind: Schema.Literal('declined'), memory: Text }),
  Schema.Struct({ kind: Schema.Literal('invalid'), evidence: Schema.NonEmptyArray(Text) }),
  Schema.Struct({ kind: Schema.Literal('external-fixed'), dependency: Text, version: Text, proof: Schema.NonEmptyArray(Text) }),
  Schema.Struct({ kind: Schema.Literal('closed'), reason: Text }),
]);
export type IssueClosure = typeof IssueClosureSchema.Type;
export const IssueOriginSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('dev'), repository: Text, commit: Schema.optional(Text) }),
  Schema.Struct({ kind: Schema.Literal('dogfood'), repository: Text, originId: Text, commit: Text }),
  Schema.Struct({ kind: Schema.Literal('issue'), repository: Text, number: Nat, url: Text }),
]);
export const IssueSchema = Schema.Struct({ ...base, kind: Schema.Literal('issue'), state: Schema.Literals(['draft', 'closed']),
  memoryRelations: Schema.Array(IssueMemoryRelationSchema), adoptions: IssueAdoptionsSchema, closure: Schema.optional(IssueClosureSchema),
  source: Schema.optional(FeedbackSourceSchema), origin: Schema.optional(IssueOriginSchema),
  subject: Schema.optional(Schema.Literals(['product', 'repository', 'dependency'])), claim: Schema.optional(Schema.Literals(['defect', 'friction', 'request'])),
  observation: Schema.optional(Text), impact: Schema.optional(Text), history: Schema.Array(HistorySchema),
});
export type IssueMeta = typeof IssueSchema.Type;
export const DocumentSchema = Schema.Union([FeatureSchema, UseCaseSchema, ResearchSchema, DesignSchema, RoadmapSchema, EngineeringSchema, MemorySchema, IssueSchema]);
export type DocumentMeta = typeof DocumentSchema.Type;
export type DocumentKind = DocumentMeta['kind'];
export interface DocumentRecord { readonly path: string; readonly metadata: DocumentMeta; readonly body: string; readonly digest: string }

export interface Finding { readonly code: string; readonly path: string; readonly message: string; readonly line?: number }
export const AnnotatedCaseSchema = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^neref_[0-9a-f]{32}$/u)), file: Text, line: Schema.Int, name: Text,
  contract: Text, contractKind: Schema.Literals(['feature', 'use-case']), regressions: Strings,
  status: Schema.Literals(['active', 'retired']), framework: Schema.Literals(['node:test', 'vitest', '@playwright/test']),
  skipped: Schema.Boolean,
});
export type AnnotatedCase = typeof AnnotatedCaseSchema.Type;
export interface AnnotationSnapshot {
  readonly cases: readonly AnnotatedCase[];
  readonly findings: readonly Finding[];
  readonly files: readonly { readonly path: string; readonly digest: string }[];
  readonly digest: string;
  readonly cache: { readonly status: string; readonly hits: number; readonly misses: number; readonly path: string; readonly detail?: string };
}
export interface FixedProof { readonly red: string; readonly green: string; readonly selectedCaseId: string; readonly epoch: number }
