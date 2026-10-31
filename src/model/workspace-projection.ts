import { WorkspaceConceptCatalogSchema } from './concept-directory.js';
import { Schema } from "effect";
import { AnnotatedCaseSchema, DesignSchema, EngineeringSchema, FeatureSchema, IssueSchema, MemorySchema, ProjectSchema, ResearchSchema, RoadmapSchema, UseCaseSchema } from "./shared.js";
import { GitHubRemoteFeedbackSchema, LinearRemoteFeedbackSchema, FeedbackSourceSchema } from "./feedback-schema.js";
import { CodeDeclarationSchema } from "./code-declaration.js";
const { body: _githubBody, ...githubFields } = GitHubRemoteFeedbackSchema.fields;
const { body: _linearBody, ...linearFields } = LinearRemoteFeedbackSchema.fields;
const Remote = Schema.Union([Schema.Struct(githubFields), Schema.Struct(linearFields)]);

const sourceFields = FeedbackSourceSchema.members[0].fields;

const Source = Schema.Union([
  Schema.Struct({ ...githubFields, connectionId: sourceFields.connectionId, importedAt: sourceFields.importedAt }),
  Schema.Struct({ ...linearFields, connectionId: sourceFields.connectionId, importedAt: sourceFields.importedAt }),
]);

const Issue = Schema.Struct({ ...IssueSchema.fields, source: Schema.optional(Source) });

const Metadata = Schema.Union([FeatureSchema, UseCaseSchema, ResearchSchema, DesignSchema, RoadmapSchema, EngineeringSchema, MemorySchema, Issue]);

const Document = Schema.Struct({ path: Schema.String, digest: Schema.String, metadata: Metadata });

const Finding = Schema.Struct({ code: Schema.String, path: Schema.String, message: Schema.String, line: Schema.optional(Schema.Int) });

const ErrorFields = { code: Schema.String, message: Schema.String };

const Instant = Schema.String.check(Schema.makeFilter(value => Number.isFinite(Date.parse(value))));

const Diagnostic = Schema.Union([
  Schema.Struct({ operation: Schema.Literal('doctor'), ok: Schema.Boolean, root: Schema.String, node: Schema.String, configuration: ProjectSchema,
    writing: Schema.optional(Schema.Struct({ complete: Schema.Boolean, ok: Schema.Boolean })),
    missingTestRoots: Schema.Array(Schema.String), missingSourceRoots: Schema.Array(Schema.String), codeDeclarations: Schema.Number,
    documents: Schema.Number, cases: Schema.Number, findings: Schema.Array(Finding), nextSteps: Schema.Array(Schema.String) }),
  Schema.Struct({ ok: Schema.optional(Schema.Boolean), error: Schema.String, message: Schema.String }),
]);
export const WorkspaceProjectionSnapshotSchema = Schema.Struct({
  complete: Schema.optional(Schema.Boolean), root: Schema.String, project: Schema.NullOr(ProjectSchema), configDigest: Schema.NullOr(Schema.String),
  conceptCatalogs: Schema.Array(WorkspaceConceptCatalogSchema),
  documents: Schema.Array(Document),
  feedback: Schema.Array(Schema.Struct({ document: Schema.Struct({ path: Schema.String, digest: Schema.String, metadata: Issue }),
    provider: Schema.Literals(['local', 'github', 'linear']), triage: Schema.Literals(['pending', 'linked', 'closed']),
    availability: Schema.Literals(['local', 'cached', 'unavailable']), warnings: Schema.Array(Schema.String), remote: Schema.NullOr(Remote) })),
  pages: Schema.Array(Schema.Struct({ path: Schema.String, digest: Schema.String, documentPath: Schema.optional(Schema.String), derivedTitle: Schema.optional(Schema.String) })),
  cases: Schema.Array(AnnotatedCaseSchema), codes: Schema.Array(CodeDeclarationSchema),
  edges: Schema.Array(Schema.Struct({ from: Schema.String, to: Schema.String, relation: Schema.String })), findings: Schema.Array(Finding),
  sources: Schema.Array(Schema.Struct({ path: Schema.String, digest: Schema.String })), evidenceIds: Schema.Array(Schema.String),
  templates: Schema.Array(Schema.Struct({ name: Schema.String, description: Schema.String })),
  cache: Schema.Struct({ status: Schema.String, hits: Schema.optional(Schema.Number), misses: Schema.optional(Schema.Number), path: Schema.optional(Schema.String), detail: Schema.optional(Schema.String) }),
  diagnostics: Diagnostic,
});
export const WorkspaceProjectionRecordSchema = Schema.Struct({
  builtAt: Instant, builtFrom: Instant, builtUntil: Instant,
  consistent: Schema.Boolean, complete: Schema.Boolean, changedPaths: Schema.Array(Schema.String), unknownRelations: Schema.Boolean,
  snapshot: WorkspaceProjectionSnapshotSchema,
}).check(Schema.makeFilter(value => value.consistent === (value.changedPaths.length === 0)
  && value.complete === (value.consistent && value.snapshot.complete === true)
  && value.unknownRelations === !value.complete
  && Date.parse(value.builtFrom) <= Date.parse(value.builtUntil)));

const Attempt = Schema.Struct({ at: Instant, complete: Schema.Boolean, changedPaths: Schema.Array(Schema.String) });

const RefreshError = Schema.Struct({ failedAt: Instant, ...ErrorFields, message: Schema.String.check(Schema.isMaxLength(4096)) });

export const WorkspaceProjectionEnvelope = Schema.Struct({ format: Schema.Literal('concord.workspace-projection/v1'), identity: Schema.String,
  record: Schema.optional(WorkspaceProjectionRecordSchema), lastAttempt: Schema.optional(Attempt), error: Schema.optional(RefreshError) });
export type WorkspaceProjectionRecord = typeof WorkspaceProjectionRecordSchema.Type;
export interface WorkspaceProjectionContext { readonly root: string; readonly privateDir: string; readonly identity: string }
export const WORKSPACE_PROJECTION_LIMIT = 8 * 1024 * 1024;



export const decodeEnvelope = Schema.decodeUnknownSync(WorkspaceProjectionEnvelope, { onExcessProperty: 'error' });
export const decodeWorkspaceProjectionRecord = Schema.decodeUnknownSync(WorkspaceProjectionRecordSchema, { onExcessProperty: 'error' });


/** Binds the fixed row to this worktree, raw configuration and installed executable. */
