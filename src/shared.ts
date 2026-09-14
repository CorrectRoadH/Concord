// @concord-file shared-domain-contracts
// @concord-implements docs/feature/local-sdlc/README.md
import { createHash } from 'node:crypto';
import { Schema } from 'effect';
import { FeedbackConnectionsSchema, FeedbackSourceSchema } from './feedback-schema.js';
export * from './feedback-schema.js';

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
export const ProjectSchema = Schema.Struct({ format: Schema.Literal('concord.project/v1'), projectId: Text, testRoots: Schema.Array(Text), sourceRoots: Schema.optional(Schema.Array(Text)), runner: RunnerSchema, feedbackConnections: Schema.optional(FeedbackConnectionsSchema) });
export type ProjectConfig = typeof ProjectSchema.Type;

export interface Change { readonly path: string; readonly before: string | null; readonly after: string | null }
export interface MutationReceipt { readonly operation: string; readonly dryRun: boolean; readonly changedPaths: readonly string[]; readonly recoveryRequired?: boolean }
export interface Repository {
  readonly root: string;
  readonly privateDir: string;
  readonly config: ProjectConfig;
  read(path: string): string | undefined;
  files(prefix: string): string[];
  absolute(path: string): string;
  publish(operation: string, changes: readonly Change[], dryRun?: boolean): MutationReceipt;
}

export const ResolutionSchema = Schema.Struct({
  kind: Schema.Literals(['fixed', 'not-a-bug', 'wont-fix', 'external-fixed']),
  reason: Text, at: Text, epoch: Nat,
  evidenceLevel: Schema.Literals(['command', 'author']),
  red: Schema.optional(Text), green: Schema.optional(Text), selectedCaseId: Schema.optional(Text),
});
export type Resolution = typeof ResolutionSchema.Type;
export const HistorySchema = Schema.Struct({ at: Text, action: Text, reason: Text, ref: Schema.optional(Text), resolution: Schema.optional(ResolutionSchema) });
export type HistoryEntry = typeof HistorySchema.Type;
const base = { format: Schema.Literal('concord.document/v1'), id: Slug, title: Text, createdAt: Text };
export const FeatureSchema = Schema.Struct({ ...base, kind: Schema.Literal('feature'), origin: Schema.optional(Text) });
export const UseCaseSchema = Schema.Struct({ ...base, kind: Schema.Literal('use-case'), feature: Text });
export const ResearchSchema = Schema.Struct({ ...base, kind: Schema.Literal('research'), observedAt: Text, sources: Strings });
export const DesignSchema = Schema.Struct({ ...base, kind: Schema.Literal('design'), alternatives: Schema.NonEmptyArray(Slug), decision: Schema.optional(Schema.Struct({ selected: Slug, reason: Text, at: Text, targets: Strings })) });
export const RoadmapSchema = Schema.Struct({ ...base, kind: Schema.Literal('roadmap'), state: Schema.Literals(['planned', 'adopted']), adoptedAs: Schema.optional(Text) });
export const EngineeringSchema = Schema.Struct({ ...base, kind: Schema.Literal('engineering') });
export const MemorySchema = Schema.Struct({ ...base, kind: Schema.Literal('memory'), memoryKind: Schema.Literals(['problem', 'decision', 'insight']), state: Schema.Literals(['open', 'resolved', 'current', 'superseded']), epoch: Nat, promotions: Strings, history: Schema.Array(HistorySchema), resolution: Schema.optional(ResolutionSchema), supersededBy: Schema.optional(Text) });
export type MemoryMeta = typeof MemorySchema.Type;
export const IssueSchema = Schema.Struct({ ...base, kind: Schema.Literal('issue'), state: Schema.Literals(['draft', 'closed']), memories: Strings, features: Schema.optional(Strings), source: Schema.optional(FeedbackSourceSchema), history: Schema.Array(HistorySchema) });
export const DocumentSchema = Schema.Union([FeatureSchema, UseCaseSchema, ResearchSchema, DesignSchema, RoadmapSchema, EngineeringSchema, MemorySchema, IssueSchema]);
export type DocumentMeta = typeof DocumentSchema.Type;
export type DocumentKind = DocumentMeta['kind'];
export interface DocumentRecord { readonly path: string; readonly metadata: DocumentMeta; readonly body: string; readonly digest: string }

export interface Finding { readonly code: string; readonly path: string; readonly message: string; readonly line?: number }
export const AnnotatedCaseSchema = Schema.Struct({
  id: Slug, file: Text, line: Schema.Int, name: Text, contract: Text, regressions: Strings,
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
