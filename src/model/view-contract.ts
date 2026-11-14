import type { WorkspaceConceptCatalog } from './concept-directory.ts';
import { Schema } from "effect";
import { PageTheme } from './herdr-mod/index.ts';
import { FeedbackFilterFields } from "./feedback-filter.ts";
import { TEMPLATE_PAGES } from "./template-pages.ts";
import type { CodeDeclaration } from "./code-declaration.ts";
import type { NativeBindingView } from './test-adapter-protocol.ts';
import type { GitDiff, GitStatus } from "./git-values.ts";
import type { AnnotatedCase, DocumentKind, DocumentMeta, DocumentRecord, Finding, ProjectConfig } from "./shared.ts";
import { MEMORY_RELATION_KINDS, ProjectSchema } from "./shared.ts";
import type { TraceEdge } from "./trace-edge.ts";
import type { FeedbackAvailability, FeedbackItem, FeedbackTriage, RemoteFeedback } from "./feedback-schema.ts";
import { WritingPolicySchema } from "./writing-schema.ts";

// @concord-begin
// @concord-implements docs/feature/web-workbench/architecture.md
export interface ViewFile {
  readonly path: string;
  readonly body: string;
  readonly digest: string;
  readonly documentPath?: string;
  readonly document?: DocumentRecord;
  readonly project?: ProjectConfig;
  readonly feedback?: FeedbackItem;
}

export interface WorkspaceSnapshot {
  readonly complete?: boolean;
  readonly root: string;
  readonly project: ProjectConfig | null;
  readonly configDigest: string | null;
  readonly documents: readonly DocumentRecord[];
  readonly feedback: readonly FeedbackItem[];
  readonly pages: readonly ViewFile[];
  readonly cases: readonly AnnotatedCase[];
  readonly bindings: readonly NativeBindingView[];
  readonly codes: readonly CodeDeclaration[];
  readonly edges: readonly TraceEdge[];
  readonly findings: readonly Finding[];
  readonly sources: readonly { readonly path: string; readonly digest: string }[];
  readonly evidenceIds: readonly string[];
  readonly templates: readonly { readonly name: string; readonly description: string }[];
  readonly cache: unknown;
  readonly diagnostics: unknown;
}

/**
 * Durable, body-free projection collections shared by Web and CLI.
 * `WorkspaceDocument` is a `DocumentRecord` without its body; an issue's
 * `metadata.source.body` is removed as well. Detail bodies are always read
 * through directed current `/api/file` reads, never from this cache.
 */
export type WorkspaceRemote =
  | Omit<Extract<RemoteFeedback, { readonly provider: 'github' }>, 'body'>
  | Omit<Extract<RemoteFeedback, { readonly provider: 'linear' }>, 'body'>;
export type WorkspaceFeedbackSource = WorkspaceRemote & { readonly connectionId: string; readonly importedAt: string };
export type WorkspaceDocumentMetadata =
  | Exclude<DocumentMeta, { readonly kind: 'issue' }>
  | (Omit<Extract<DocumentMeta, { readonly kind: 'issue' }>, 'source'> & { readonly source?: WorkspaceFeedbackSource });
export interface WorkspaceDocument {
  readonly path: string;
  readonly metadata: WorkspaceDocumentMetadata;
  readonly digest: string;
}
export interface WorkspaceIssueDocument {
  readonly path: string;
  readonly metadata: Extract<WorkspaceDocumentMetadata, { readonly kind: 'issue' }>;
  readonly digest: string;
}
export interface WorkspacePage {
  readonly path: string;
  readonly digest: string;
  readonly documentPath?: string;
  readonly derivedTitle?: string;
}
export interface WorkspaceFeedback {
  readonly document: WorkspaceIssueDocument;
  readonly provider: 'local' | 'github' | 'linear';
  readonly triage: FeedbackTriage;
  readonly availability: FeedbackAvailability;
  readonly warnings: readonly string[];
  readonly remote: WorkspaceRemote | null;
}
/** Navigator-only derivation of `WorkspaceSnapshot`; never authorizes current facts. */
export interface WorkspaceProjectionSnapshot {
  readonly complete?: boolean;
  readonly root: string;
  readonly project: ProjectConfig | null;
  readonly configDigest: string | null;
  readonly conceptCatalogs: readonly WorkspaceConceptCatalog[];
  readonly documents: readonly WorkspaceDocument[];
  readonly feedback: readonly WorkspaceFeedback[];
  readonly pages: readonly WorkspacePage[];
  readonly cases: readonly AnnotatedCase[];
  readonly bindings: readonly NativeBindingView[];
  readonly codes: readonly CodeDeclaration[];
  readonly edges: readonly TraceEdge[];
  readonly findings: readonly Finding[];
  readonly sources: readonly { readonly path: string; readonly digest: string }[];
  readonly evidenceIds: readonly string[];
  readonly templates: readonly { readonly name: string; readonly description: string }[];
  readonly cache: unknown;
  readonly diagnostics: unknown;
}
// @concord-end
export interface WorkspaceProjectionRefreshError { readonly failedAt: string; readonly code: string; readonly message: string }
export interface WorkspaceProjectionAttempt { readonly at: string; readonly complete: boolean; readonly changedPaths: readonly string[] }
/** Accepted navigation results describe a completed scan, never current facts. */
export interface WorkspaceProjectionStatus {
  readonly sourceDigest: string;
  readonly status: 'ready' | 'refresh-failed' | 'blocked';
  readonly current: false;
  readonly refreshOwner: 'active' | 'none';
  readonly builtAt: string;
  readonly builtFrom: string;
  readonly builtUntil: string;
  readonly complete: boolean;
  readonly changedPaths: readonly string[];
  readonly unknownRelations: boolean;
  readonly lastError?: WorkspaceProjectionRefreshError;
  readonly lastAttempt?: WorkspaceProjectionAttempt;
}
export interface WorkspaceProjection {
  readonly snapshot: WorkspaceProjectionSnapshot;
  readonly projection: WorkspaceProjectionStatus;
}

export interface ViewSuccess<T> { readonly ok: true; readonly value: T }
export interface ViewFailure { readonly ok: false; readonly complete?: false; readonly error: string; readonly message: string; readonly details?: unknown }
export type ViewResponse<T> = ViewSuccess<T> | ViewFailure;
export type { GitDiff, GitStatus };

const Text = Schema.String.check(Schema.isMinLength(1));
const Strings = Schema.Array(Text);
// @concord-begin
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md#主流程
export const ProjectInputSchema = ProjectSchema;
const DryRun = { dryRun: Schema.optional(Schema.Boolean) } as const;

/** Strictly decoded at every CLI and HTTP action boundary. */
export const ViewActionSchema = Schema.Union([
  Schema.Struct({ action: Schema.Literal('file.get'), path: Text }),
  Schema.Struct({ action: Schema.Literal('page.render'), path: Text, theme: PageTheme }),
  Schema.Struct({ action: Schema.Literal('init'), testRoots: Schema.optional(Strings), sourceRoots: Schema.optional(Strings), docsOnly: Schema.optional(Schema.Boolean), ...DryRun }),
  Schema.Struct({ action: Schema.Literal('recover') }),
  Schema.Struct({
    action: Schema.Literal('document.create'),
    kind: Schema.Literals(['feature', 'use-case', 'design', 'roadmap', 'engineering', 'memory', 'issue']),
    id: Text,
    title: Text,
    body: Schema.optional(Schema.String),
    feature: Schema.optional(Text),
    pages: Schema.optional(Schema.Array(Schema.Literals(TEMPLATE_PAGES))),
    ...DryRun,
  }),
  Schema.Struct({ action: Schema.Literal('document.set'), path: Text, body: Schema.String, expectedDigest: Schema.NullOr(Text), ...DryRun }),
  Schema.Struct({ action: Schema.Literal('roadmap.start'), id: Text, feature: Schema.optional(Text), ...DryRun }),
  Schema.Struct({ action: Schema.Literal('memory.index') }),
  Schema.Struct({ action: Schema.Literal('memory.search'), query: Text }),
  Schema.Struct({ action: Schema.Literal('memory.link'), id: Text, target: Text, role: Schema.optional(Schema.Literals(['supports'])), ...DryRun }),
  Schema.Struct({ action: Schema.Literal('issue.unlink'), id: Text, memory: Text, role: Schema.optional(Schema.Literals([...MEMORY_RELATION_KINDS, 'spec'])), ...DryRun }),
  Schema.Struct({ action: Schema.Literal('issue.link'), id: Text, memory: Text, role: Schema.optional(Schema.Literals([...MEMORY_RELATION_KINDS, 'spec'])), ...DryRun }),
  Schema.Struct({ action: Schema.Literal('issue.index') }),
  Schema.Struct({ action: Schema.Literal('issue.list'), ...FeedbackFilterFields }),
  Schema.Struct({ action: Schema.Literal('feedback.list'), ...FeedbackFilterFields }),
  Schema.Struct({ action: Schema.Literal('issue.search'), query: Text }),
  Schema.Struct({ action: Schema.Literal('issue.edit'), id: Text, body: Schema.String, expectedDigest: Text, ...DryRun }),
  Schema.Struct({ action: Schema.Literal('issue.remove'), id: Text, expectedDigest: Text, ...DryRun }),
  Schema.Struct({ action: Schema.Literal('issue.close'), id: Text, reason: Schema.optional(Text), ...DryRun }),
  Schema.Struct({ action: Schema.Literal('feedback.sync'), connection: Text, url: Schema.optional(Text), ...DryRun }),
  Schema.Struct({ action: Schema.Literal('feedback.check'), connection: Text }),
  Schema.Struct({ action: Schema.Literal('feedback.link'), id: Text, feature: Text, ...DryRun }),
  Schema.Struct({ action: Schema.Literal('source.set'), path: Text, body: Schema.String, expectedDigest: Text, ...DryRun }),
  Schema.Struct({ action: Schema.Literal('writing.index') }),
  Schema.Struct({ action: Schema.Literal('writing.show'), path: Schema.optional(Text) }),
  Schema.Struct({ action: Schema.Literal('writing.check'), path: Schema.optional(Text) }),
  Schema.Struct({ action: Schema.Literal('concepts.index') }),
  Schema.Struct({ action: Schema.Literal('concepts.show'), path: Schema.optional(Text) }),
  Schema.Struct({ action: Schema.Literal('config.set'), config: ProjectInputSchema, expectedDigest: Text, ...DryRun }),
  Schema.Struct({ action: Schema.Literal('code.marker'), scope: Schema.Literals(['file', 'node', 'region']), contracts: Strings }),
  Schema.Struct({ action: Schema.Literal('code.at'), path: Text, line: Schema.Int }),
  Schema.Struct({ action: Schema.Literal('test.marker'), contract: Text, issues: Strings }),
  Schema.Struct({ action: Schema.Literal('cache.status') }),
  Schema.Struct({ action: Schema.Literal('cache.clear'), ...DryRun }),
  Schema.Struct({ action: Schema.Literal('cache.rebuild') }),
  Schema.Struct({ action: Schema.Literal('check') }),
  Schema.Struct({ action: Schema.Literal('trace.check') }),
  Schema.Struct({ action: Schema.Literal('trace.show'), reference: Text }),
  Schema.Struct({ action: Schema.Literal('review'), reference: Schema.optional(Text) }),
  Schema.Struct({ action: Schema.Literal('template.show'), name: Text, title: Schema.optional(Text) }),
  Schema.Struct({ action: Schema.Literal('doctor') }),
]);
// @concord-end

export type ViewAction = typeof ViewActionSchema.Type;

// Keep these assignments close to the schema so drift is caught without runtime imports.
type _ProjectCompatible = ProjectConfig extends typeof ProjectInputSchema.Type ? true : never;
type _KindCompatible = DocumentKind extends Extract<ViewAction, { action: 'document.create' }>['kind'] ? true : never;
const _typeCompatibility: readonly [_ProjectCompatible, _KindCompatible] = [true, true];
void _typeCompatibility;
