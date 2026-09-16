// @concord-file web-workbench-contract
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import { Schema } from 'effect';
import { TEMPLATE_PAGES } from './template-pages.js';
import type { CodeDeclaration } from './code.js';
import type { Evidence } from './evidence.js';
import type { GitDiff, GitStatus } from './git-view.js';
import type {
  AnnotatedCase,
  DocumentKind,
  DocumentRecord,
  Finding,
  ProjectConfig,
  Runner,
} from './shared.js';
import { MemorySourceSchema, ProjectSchema } from './shared.js';
import type { TraceEdge } from './trace.js';
import { FeedbackConnectionsSchema, type FeedbackItem } from './feedback-schema.js';

export interface ViewFile {
  readonly path: string;
  readonly body: string;
  readonly digest: string;
  readonly readOnly: boolean;
  readonly reason?: string;
  readonly documentPath?: string;
}

export interface WorkspaceSnapshot {
  readonly repositoryTests?: import('./view-profile.js').RepositoryTestView;
  readonly root: string;
  readonly project: ProjectConfig | null;
  readonly configDigest: string | null;
  readonly documents: readonly DocumentRecord[];
  readonly feedback: readonly FeedbackItem[];
  readonly pages: readonly ViewFile[];
  readonly cases: readonly AnnotatedCase[];
  readonly codes: readonly CodeDeclaration[];
  readonly edges: readonly TraceEdge[];
  readonly findings: readonly Finding[];
  readonly sources: readonly { readonly path: string; readonly digest: string }[];
  readonly evidenceIds: readonly string[];
  readonly templates: readonly { readonly name: string; readonly description: string }[];
  readonly cache: unknown;
  readonly diagnostics: unknown;
}

export type ViewJobState = 'queued' | 'running' | 'cancelling' | 'cancelled' | 'completed' | 'failed' | 'cleanup-failed';
export interface ViewJob {
  readonly id: string;
  readonly caseId: string;
  readonly state: ViewJobState;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly evidence?: Evidence;
  readonly error?: { readonly code: string; readonly message: string };
}

export interface ViewSuccess<T> { readonly ok: true; readonly value: T }
export interface ViewFailure { readonly ok: false; readonly error: string; readonly message: string; readonly details?: unknown }
export type ViewResponse<T> = ViewSuccess<T> | ViewFailure;
export type { GitDiff, GitStatus };

const Text = Schema.String.check(Schema.isMinLength(1));
const Strings = Schema.Array(Text);
const RunnerInputSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('node-test'),
    sourceFiles: Strings,
    timeoutMs: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 3_600_000 })),
  }),
  Schema.Struct({
    kind: Schema.Literal('command'),
    argv: Schema.NonEmptyArray(Text),
    sourceFiles: Strings,
    timeoutMs: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 3_600_000 })),
  }),
]);
export const ProjectInputSchema = ProjectSchema;
const DryRun = { dryRun: Schema.optional(Schema.Boolean) } as const;

/** Strictly decoded at every CLI and HTTP action boundary. */
export const ViewActionSchema = Schema.Union([
  Schema.Struct({ action: Schema.Literal('init'), testRoots: Schema.optional(Strings), sourceRoots: Schema.optional(Strings), runner: Schema.optional(RunnerInputSchema), docsOnly: Schema.optional(Schema.Boolean), projectTypes: Schema.optional(Schema.Array(Schema.Literals(['library', 'cli']))), pages: Schema.optional(Schema.Array(Schema.Literals(TEMPLATE_PAGES))), design: Schema.optional(Schema.Boolean), constitutionBody: Schema.optional(Schema.String), adoptConstitution: Schema.optional(Schema.Boolean), constitutionReason: Schema.optional(Text), constitutionImpact: Schema.optional(Text), constitutionSources: Schema.optional(Strings), memorySources: Schema.optional(Schema.NonEmptyArray(MemorySourceSchema)), ...DryRun }),
  Schema.Struct({ action: Schema.Literal('recover') }),
  Schema.Struct({
    action: Schema.Literal('document.create'),
    kind: Schema.Literals(['feature', 'use-case', 'research', 'design', 'roadmap', 'engineering', 'memory', 'issue']),
    id: Text,
    title: Text,
    body: Schema.optional(Schema.String),
    feature: Schema.optional(Text),
    observedAt: Schema.optional(Text),
    sources: Schema.optional(Strings),
    alternatives: Schema.optional(Strings),
    pages: Schema.optional(Schema.Array(Schema.Literals(TEMPLATE_PAGES))),
    constitutionRefs: Schema.optional(Strings),
    memorySource: Schema.optional(Text),
    memoryKind: Schema.optional(Schema.Literals(['problem', 'decision', 'insight', 'note'])),
    ...DryRun,
  }),
  Schema.Struct({ action: Schema.Literal('document.set'), path: Text, body: Schema.String, expectedDigest: Text, ...DryRun }),
  Schema.Struct({ action: Schema.Literal('document.metadata'), reference: Text, expectedDigest: Text, title: Schema.optional(Text), observedAt: Schema.optional(Schema.NullOr(Text)), sources: Schema.optional(Strings), constitutionRefs: Schema.optional(Strings), ...DryRun }),
  Schema.Struct({ action: Schema.Literal('page.add'), kind: Schema.Literals(['feature', 'roadmap', 'design', 'engineering', 'research']), id: Text, page: Text, plan: Schema.optional(Text), ...DryRun }),
  Schema.Struct({ action: Schema.Literal('roadmap.adopt'), id: Text, feature: Text, ...DryRun }),
  Schema.Struct({ action: Schema.Literal('design.decide'), id: Text, selected: Text, targets: Strings, reason: Text, ...DryRun }),
  Schema.Struct({ action: Schema.Literal('memory.resolve'), id: Text, kind: Schema.Literals(['fixed', 'not-a-bug', 'wont-fix', 'external-fixed']), reason: Text, red: Schema.optional(Text), green: Schema.optional(Text), ...DryRun }),
  Schema.Struct({ action: Schema.Literal('memory.activate'), id: Text, reason: Text, ...DryRun }),
  Schema.Struct({ action: Schema.Literal('memory.reopen'), id: Text, reason: Text, ...DryRun }),
  Schema.Struct({ action: Schema.Literal('memory.supersede'), id: Text, replacement: Text, reason: Text, ...DryRun }),
  Schema.Struct({ action: Schema.Literal('memory.promote'), id: Text, target: Text, ...DryRun }),
  Schema.Struct({ action: Schema.Literal('memory.retire'), id: Text, target: Text, reason: Text, ...DryRun }),
  Schema.Struct({ action: Schema.Literal('issue.link'), id: Text, memory: Text, ...DryRun }),
  Schema.Struct({ action: Schema.Literal('issue.close'), id: Text, reason: Text, ...DryRun }),
  Schema.Struct({ action: Schema.Literal('feedback.sync'), connection: Text, url: Schema.optional(Text), ...DryRun }),
  Schema.Struct({ action: Schema.Literal('feedback.link'), id: Text, feature: Text, ...DryRun }),
  Schema.Struct({ action: Schema.Literal('source.set'), path: Text, body: Schema.String, expectedDigest: Text, ...DryRun }),
  Schema.Struct({ action: Schema.Literal('config.set'), config: ProjectInputSchema, expectedDigest: Text, ...DryRun }),
  Schema.Struct({ action: Schema.Literal('constitution.initialize'), ...DryRun }),
  Schema.Struct({ action: Schema.Literal('constitution.adopt'), body: Schema.String, reason: Text, impact: Text, sources: Strings, expectedDigest: Text, ...DryRun }),
  Schema.Struct({ action: Schema.Literal('constitution.amend'), version: Text, body: Schema.String, reason: Text, impact: Text, sources: Strings, expectedDigest: Text, ...DryRun }),
  Schema.Struct({ action: Schema.Literal('code.annotate'), id: Text, scope: Schema.Literals(['file', 'node', 'region']), contracts: Strings }),
  Schema.Struct({ action: Schema.Literal('code.locate'), path: Text, line: Schema.Int }),
  Schema.Struct({ action: Schema.Literal('test.annotate'), contract: Text, regressions: Strings }),
  Schema.Struct({ action: Schema.Literal('evidence.show'), id: Text }),
  Schema.Struct({ action: Schema.Literal('cache.status') }),
  Schema.Struct({ action: Schema.Literal('cache.clear'), ...DryRun }),
  Schema.Struct({ action: Schema.Literal('cache.rebuild') }),
  Schema.Struct({ action: Schema.Literal('check') }),
  Schema.Struct({ action: Schema.Literal('trace.check') }),
  Schema.Struct({ action: Schema.Literal('trace.show'), reference: Text }),
  Schema.Struct({ action: Schema.Literal('review.render'), reference: Schema.optional(Text) }),
  Schema.Struct({ action: Schema.Literal('template.show'), name: Text, title: Schema.optional(Text) }),
  Schema.Struct({ action: Schema.Literal('doctor') }),
]);

export type ViewAction = typeof ViewActionSchema.Type;

// Keep these assignments close to the schema so drift is caught without runtime imports.
type _RunnerCompatible = Runner extends typeof RunnerInputSchema.Type ? true : never;
type _ProjectCompatible = ProjectConfig extends typeof ProjectInputSchema.Type ? true : never;
type _KindCompatible = DocumentKind extends Extract<ViewAction, { action: 'document.create' }>['kind'] ? true : never;
const _typeCompatibility: readonly [_RunnerCompatible, _ProjectCompatible, _KindCompatible] = [true, true, true];
void _typeCompatibility;
