import { createHash } from "node:crypto";
import { Schema } from "effect";
import { LanguageServersSchema } from "./language-server-config.ts";
import { TestAdapterSchema, validAdapters } from "./test-adapter-config.ts";
import { validSourceIgnore } from "./source-discovery.ts";
import { DOCUMENT_NAME_PATTERN } from "./document-name.ts";
import { FeedbackConnectionsSchema, FeedbackSourceSchema } from "./feedback-schema.ts";



// @concord-begin
// @concord-implements docs/feature/local-sdlc/architecture.md#编译管线
export class ConcordError extends Error {
  readonly name = 'ConcordError';
  readonly code: string;
  readonly details?: unknown;
  constructor(code: string, message: string, details?: unknown) { super(message); this.code = code; this.details = details; }
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
export const DocumentName = Schema.String.check(Schema.isPattern(DOCUMENT_NAME_PATTERN));
export function slug(value: string): string { return decode(Slug, value, 'identifier'); }
export const Nat = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const Strings = Schema.Array(Text);
// @concord-end
// @concord-begin
// @concord-implements docs/feature/project-onboarding/use-case/maintain-project-config.md
export const RunnerSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('node-test'), sourceFiles: Strings, prepare: Schema.optional(Schema.Array(Schema.NonEmptyArray(Text))), timeoutMs: Schema.Int.check(Schema.isBetween({minimum: 1, maximum: 3600000})) }),
  Schema.Struct({ kind: Schema.Literal('command'), argv: Schema.NonEmptyArray(Text), sourceFiles: Strings, prepare: Schema.optional(Schema.Array(Schema.NonEmptyArray(Text))), timeoutMs: Schema.Int.check(Schema.isBetween({minimum: 1, maximum: 3600000})) }),
]);
export type Runner = typeof RunnerSchema.Type;
export const TemplatePageSchema = Schema.Literals(['library', 'cli', 'api', 'format', 'ui', 'performance', 'architecture', 'data-model', 'use-case']);
export const ProjectSchema = Schema.Struct({
  testRoots: Schema.optional(Schema.Array(Text)),
  sourceRoots: Schema.optional(Schema.Array(Text)),
  languageServers: Schema.optional(LanguageServersSchema),
  sourceIgnore: Schema.optional(Schema.Array(Text.check(Schema.makeFilter(validSourceIgnore)))),
  p5: Schema.optional(Schema.Struct({
    libraries: Schema.Array(Text).check(Schema.isMaxLength(16), Schema.makeFilter(values => new Set(values).size === values.length)),
  })),
  runner: Schema.optional(RunnerSchema),
  testAdapters: Schema.optional(Schema.Array(TestAdapterSchema)),
  docsWork: Schema.optional(Schema.Struct({
    checks: Schema.optional(Schema.Record(Schema.String, Schema.Struct({ argv: Schema.NonEmptyArray(Text), timeoutMs: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))) }))),
    finalizer: Schema.optional(Schema.Struct({ argv: Schema.NonEmptyArray(Text), timeoutMs: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))) })),
    sharedPaths: Schema.optional(Schema.Array(Text)),
  })),
  feedbackConnections: Schema.optional(FeedbackConnectionsSchema),
}).check(Schema.makeFilter(validAdapters));
export type ProjectConfig = typeof ProjectSchema.Type;
export type ResolvedProjectConfig = ProjectConfig & { readonly testRoots: readonly string[]; readonly sourceRoots: readonly string[] };
export interface ConfigSnapshot { readonly path: 'concord.config.ts'; readonly source: string; readonly digest: string; readonly config: ProjectConfig }
// @concord-end

// @concord-begin
// @concord-implements docs/feature/portable-coordination/architecture.md#entity-ownership
export interface Change { readonly path: string; readonly before: string | null; readonly after: string | null }
export interface MutationReceipt { readonly operation: string; readonly dryRun: boolean; readonly changedPaths: readonly string[]; readonly recoveryRequired?: boolean }
export interface Repository {
  readonly access?: 'read' | 'write';
  readonly persistentCache?: 'use' | 'off';
  readonly root: string;
  readonly privateDir: string;
  readonly runtimeVersion?: string;
  exists?(path: string): boolean;
  readonly config: ResolvedProjectConfig;
  readonly configSnapshot: ConfigSnapshot;
  snapshot?<A>(read: () => A): A;
  read(path: string): string | undefined;
  readBytes?(path: string): Uint8Array | undefined;
  inspect?(path: string): { readonly file: boolean; readonly directory: boolean; readonly symbolicLink: boolean; readonly size: number; readonly mode: number; readonly identity: string } | undefined;
  rootFiles?(): readonly string[];
  runtimeInputs?(command: string, envNames: readonly string[]): { readonly executable: { readonly path: string; readonly digest: string }; readonly env: Readonly<Record<string, string | undefined>>; readonly implementation: string; readonly version: string };
  environment?(names?: readonly string[]): Readonly<Record<string, string | undefined>>;
  files(prefix: string, scope?: 'source'): string[];
  absolute(path: string): string;
  publish(operation: string, changes: readonly Change[], dryRun?: boolean): MutationReceipt;
}

/** Named operations own a coherent short snapshot; nested calls reuse it. */
export function inRepositorySnapshot<A>(repo: Repository, operation: () => A): A {
  return repo.snapshot === undefined ? operation() : repo.snapshot(operation);
}
// @concord-end

// @concord-begin
// @concord-implements docs/feature/local-sdlc/architecture.md#执行管线
export const Sha256 = Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/));
export const ContentHash = Schema.String.check(Schema.isPattern(/^(?:sha256:)?[0-9a-f]{64}$/));
export const GitCommit = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/));
export const SourceRecordSchema = Schema.Struct({ path: Text, commit: GitCommit, digest: Sha256 });
// @concord-end
// @concord-begin
// @concord-implements docs/feature/local-sdlc/format.md#owner
/** Declarative owners hold current declarations only; Git and record owners keep their history (C-012-11). */
const Title = Text.check(Schema.isMaxLength(1024), Schema.isPattern(/^[^\r\n\u2028\u2029]+$/u));
const declarative = { format: Schema.Literal('concord.document/v1'), id: DocumentName, title: Title, description: Schema.optional(Text) };
const base = { ...declarative, createdAt: Schema.optional(Text),
  createdAtSource: Schema.optional(Schema.Struct({ kind: Schema.Literal('first-recorded'), path: Text, commit: GitCommit })),
};
export const FeatureSchema = Schema.Struct({ ...declarative, kind: Schema.Literal('feature') });
export const UseCaseSchema = Schema.Struct({ ...declarative, kind: Schema.Literal('use-case'), feature: Text });
export const HistoricalDispositionSchema = Schema.Struct({ reason: Text, source: Schema.optional(SourceRecordSchema), eventAt: Schema.optional(Text) });
export const DesignSchema = Schema.Struct({ ...declarative, kind: Schema.Literal('design') });
export const RoadmapSchema = Schema.Struct({ ...base, kind: Schema.Literal('roadmap'), state: Schema.Literals(['planned', 'adopted', 'cancelled']), adoptedAs: Schema.optional(Text), cancellation: Schema.optional(HistoricalDispositionSchema) });
export const EngineeringSchema = Schema.Struct({ ...declarative, kind: Schema.Literal('engineering') });
export const MemoryRelationSchema = Schema.Struct({ role: Schema.Literal('supports'), target: Text });
export const MemorySchema = Schema.Struct({ ...declarative, kind: Schema.Literal('memory'), relations: Schema.Array(MemoryRelationSchema) });
export type MemoryMeta = typeof MemorySchema.Type;
export const MEMORY_RELATION_KINDS = ['investigation', 'root-cause', 'related'] as const;
export const IssueRelationSchema = Schema.Struct({ role: Schema.Literals([...MEMORY_RELATION_KINDS, 'spec']), target: Text });
export type IssueRelation = typeof IssueRelationSchema.Type;
export const FixVerificationSchema = Schema.Struct({ defect: GitCommit, fix: GitCommit, tests: Schema.NonEmptyArray(Text).check(Schema.makeFilter(values => new Set(values).size === values.length)), runner: Sha256, concord: Text });
export const IssueSchema = Schema.Struct({ ...declarative, kind: Schema.Literal('issue'), relations: Schema.Array(IssueRelationSchema), source: Schema.optional(FeedbackSourceSchema) });
export type IssueMeta = typeof IssueSchema.Type;
export const DocumentSchema = Schema.Union([FeatureSchema, UseCaseSchema, DesignSchema, RoadmapSchema, EngineeringSchema, MemorySchema, IssueSchema]);
export type DocumentMeta = typeof DocumentSchema.Type;
export type DocumentKind = DocumentMeta['kind'];
export interface DocumentRecord { readonly path: string; readonly metadata: DocumentMeta; readonly body: string; readonly digest: string }
// @concord-end

// @concord-begin
// @concord-implements docs/feature/local-sdlc/use-case/discover-annotated-tests.md#标记规则
export interface Finding { readonly code: string; readonly path: string; readonly message: string; readonly line?: number; readonly details?: Schema.Json }
export const AnnotatedCaseSchema = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^neref_[0-9a-f]{32}$/u)), file: Text, line: Schema.Int, name: Text,
  contract: Text, contractKind: Schema.Literals(['feature', 'use-case']), issues: Strings,
  status: Schema.Literals(['active', 'retired']), framework: Schema.Literals(['node:test', 'vitest', '@playwright/test', 'marker']),
  skipped: Schema.Boolean, named: Schema.optional(Schema.Boolean), native: Schema.optional(Text), markerEndLine: Schema.optional(Schema.Int),
});
export type AnnotatedCase = typeof AnnotatedCaseSchema.Type;
export interface AnnotationSnapshot {
  readonly cases: readonly AnnotatedCase[];
  readonly findings: readonly Finding[];
  readonly files: readonly { readonly path: string; readonly digest: string }[];
  readonly digest: string;
  readonly cache: { readonly status: string; readonly hits: number; readonly misses: number; readonly path: string; readonly detail?: string };
}
// @concord-end
