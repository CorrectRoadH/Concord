// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Schema } from 'effect';
import { discoverRoot } from './storage.js';
import { genericPrivateDirectorySync } from './coordination.js';
import { assertLeasePath, ownerIsAlive, readLeaseOwner } from './file-lease.js';
import { assertCacheDatabaseSafe, cacheDatabasePath, cacheRootOwnerOnly } from './cache-file.js';
import { HawdbFailure, hawdbIdentity, openHawdb } from './hawdb-native.js';
import { hawdbTarget } from './hawdb-native-contract.js';
import { AnnotatedCaseSchema, ConcordError, DesignSchema, EngineeringSchema, FeatureSchema, IssueSchema, MemorySchema, ProjectSchema, ResearchSchema, RoadmapSchema, UseCaseSchema, digest, failure } from './shared.js';
import { GitHubRemoteFeedbackSchema, LinearRemoteFeedbackSchema, FeedbackSourceSchema } from './feedback-schema.js';
import { CodeDeclarationSchema } from './code.js';
import { RepositoryViewTestSchema } from './view-profile.js';
import type { WorkspaceProjection, WorkspaceSnapshot } from './view-contract.js';

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
    missingTestRoots: Schema.Array(Schema.String), missingSourceRoots: Schema.Array(Schema.String), codeDeclarations: Schema.Number,
    documents: Schema.Number, cases: Schema.Number, findings: Schema.Array(Finding), nextSteps: Schema.Array(Schema.String) }),
  Schema.Struct({ ok: Schema.optional(Schema.Boolean), error: Schema.String, message: Schema.String }),
]);
export const WorkspaceProjectionSnapshotSchema = Schema.Struct({
  complete: Schema.optional(Schema.Boolean), root: Schema.String, project: Schema.NullOr(ProjectSchema), configDigest: Schema.NullOr(Schema.String),
  documents: Schema.Array(Document),
  feedback: Schema.Array(Schema.Struct({ document: Schema.Struct({ path: Schema.String, digest: Schema.String, metadata: Issue }),
    provider: Schema.Literals(['local', 'github', 'linear']), triage: Schema.Literals(['pending', 'linked', 'closed']),
    availability: Schema.Literals(['local', 'cached', 'unavailable']), warnings: Schema.Array(Schema.String), remote: Schema.NullOr(Remote) })),
  pages: Schema.Array(Schema.Struct({ path: Schema.String, digest: Schema.String, documentPath: Schema.optional(Schema.String), derivedTitle: Schema.optional(Schema.String) })),
  cases: Schema.Array(AnnotatedCaseSchema), codes: Schema.Array(CodeDeclarationSchema),
  edges: Schema.Array(Schema.Struct({ from: Schema.String, to: Schema.String, relation: Schema.String })), findings: Schema.Array(Finding),
  sources: Schema.Array(Schema.Struct({ path: Schema.String, digest: Schema.String })), evidenceIds: Schema.Array(Schema.String),
  templates: Schema.Array(Schema.Struct({ name: Schema.String, description: Schema.String })),
  repositoryTests: Schema.optional(Schema.Struct({ status: Schema.Literals(['not-configured', 'ready', 'failed']), tests: Schema.Array(RepositoryViewTestSchema), error: Schema.optional(Schema.Struct(ErrorFields)) })),
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
const Envelope = Schema.Struct({ format: Schema.Literal('concord.workspace-projection/v1'), identity: Schema.String,
  record: Schema.optional(WorkspaceProjectionRecordSchema), lastAttempt: Schema.optional(Attempt), error: Schema.optional(RefreshError) });
export type WorkspaceProjectionRecord = typeof WorkspaceProjectionRecordSchema.Type;
export interface WorkspaceProjectionContext { readonly root: string; readonly privateDir: string; readonly identity: string }
export const WORKSPACE_PROJECTION_LIMIT = 8 * 1024 * 1024;
const key = 'workspace';
const decodeEnvelope = Schema.decodeUnknownSync(Envelope, { onExcessProperty: 'error' });
export const decodeWorkspaceProjectionRecord = Schema.decodeUnknownSync(WorkspaceProjectionRecordSchema, { onExcessProperty: 'error' });

/** Binds the fixed row to this worktree, raw configuration and installed executable. */
export function workspaceProjectionContext(input: string): WorkspaceProjectionContext {
  try { return identifyWorkspaceProjection(input); }
  catch (cause) {
    throw new ConcordError('WorkspaceProjectionUnavailable', 'Cannot identify the workspace cache; repair the configuration path or installation and restart View', {
      reason: cause instanceof ConcordError || cause instanceof HawdbFailure ? cause.code : 'WorkspaceProjectionIdentityUnavailable', message: cause instanceof Error ? cause.message : String(cause),
    });
  }
}
function identifyWorkspaceProjection(input: string): WorkspaceProjectionContext {
  const root = discoverRoot(input, true);
  const privateDir = genericPrivateDirectorySync(root);
  const configPath = join(root, 'concord.config.ts');
  assertLeasePath(configPath);
  const stat = lstatSync(configPath, { throwIfNoEntry: false });
  if (stat && (!stat.isFile() || stat.size > 4 * 1024 * 1024)) throw new ConcordError('InvalidConfig', 'Configuration must be a regular file within 4 MiB');
  const config = stat === undefined ? 'absent' : digest(readFileSync(configPath));
  const directory = dirname(fileURLToPath(import.meta.url));
  const installation: string[][] = [];
  const visit = (path: string, relative: string): void => {
    for (const name of readdirSync(path).sort()) {
      const target = join(path, name), rel = relative ? `${relative}/${name}` : name;
      const entry = lstatSync(target);
      if (entry.isSymbolicLink()) throw new ConcordError('UnsafePath', 'Installation contains a symbolic link');
      if (entry.isDirectory()) visit(target, rel);
      else if (entry.isFile() && (name.endsWith('.js') || rel.startsWith('native/'))) installation.push([rel, digest(readFileSync(target))]);
    }
  };
  visit(directory, '');
  for (const name of ['artifact.json', 'hawdb.node', 'THIRD-PARTY-NOTICES.txt']) {
    if (!installation.some(([path]) => path === `native/${hawdbTarget()}/${name}`)) throw new ConcordError('HawdbUnavailable', 'Required native cache artifact is missing; repair the installation and restart View');
  }
  return { root, privateDir, identity: digest(JSON.stringify([root, privateDir, config, 'workspace', installation])) };
}

/** Explicit construction, followed by strict decoding, keeps source bodies out of persistent storage. */
export function makeWorkspaceProjectionRecord(snapshot: WorkspaceSnapshot, drift: { files: readonly string[]; directories: readonly string[]; publicationChanged: boolean }, builtFrom: string): WorkspaceProjectionRecord {
  const remote = <T extends { readonly body: string }>(value: T) => { const { body: _body, ...rest } = value; return rest; };
  const document = (value: WorkspaceSnapshot['documents'][number]) => ({ path: value.path, digest: value.digest,
    metadata: value.metadata.kind === 'issue' && value.metadata.source ? { ...value.metadata, source: remote(value.metadata.source) } : value.metadata });
  const changedPaths = [...new Set([...drift.files, ...drift.directories, ...(drift.publicationChanged ? ['.'] : [])])].sort();
  const consistent = changedPaths.length === 0;
  const builtUntil = new Date().toISOString();
  const diagnostics = snapshot.diagnostics;
  // Error details may contain arbitrary source material. Only diagnostic fields are retained.
  const diagnostic = typeof diagnostics === 'object' && diagnostics !== null && 'error' in diagnostics
    ? { ...('ok' in diagnostics ? { ok: diagnostics.ok } : {}), error: diagnostics.error, message: 'message' in diagnostics ? diagnostics.message : '' }
    : diagnostics;
  return decodeWorkspaceProjectionRecord({ builtAt: builtUntil, builtFrom, builtUntil, consistent,
    complete: consistent && snapshot.complete === true, changedPaths, unknownRelations: !consistent || snapshot.complete !== true,
    snapshot: { ...snapshot, complete: consistent && snapshot.complete === true, diagnostics: diagnostic,
      documents: snapshot.documents.map(document),
      pages: snapshot.pages.map(page => ({ path: page.path, digest: page.digest, ...(page.documentPath ? { documentPath: page.documentPath } : {}),
        ...(page.body.match(/^#\s+(.+)$/mu)?.[1] ? { derivedTitle: page.body.match(/^#\s+(.+)$/mu)![1]!.trim() } : {}) })),
      feedback: snapshot.feedback.map(item => ({ ...item, document: document(item.document), remote: item.remote ? remote(item.remote) : null })),
    },
  });
}

function readEnvelope(context: WorkspaceProjectionContext): typeof Envelope.Type | undefined {
  hawdbIdentity();
  const path = cacheDatabasePath(context.privateDir);
  assertLeasePath(path);
  if (!assertCacheDatabaseSafe(path) || cacheRootOwnerOnly(path)) return undefined;
  const database = openHawdb(path, { readOnly: true, create: false });
  try {
    const payload = database.get('workspace_projection', [key])[0]?.payload;
    if (payload === undefined) return undefined;
    if (Buffer.byteLength(payload) > WORKSPACE_PROJECTION_LIMIT) throw new ConcordError('WorkspaceProjectionOutputLimit', 'Workspace projection exceeds 8 MiB');
    const envelope = decodeEnvelope(JSON.parse(payload));
    return envelope.identity === context.identity ? envelope : undefined;
  } finally { database.close(); }
}

export function workspaceRefreshOwner(context: WorkspaceProjectionContext): 'active' | 'none' {
  const owner = readLeaseOwner(join(context.privateDir, 'workspace-refresh', 'current'), 'workspace-read');
  if (!owner) return 'none';
  try { return ownerIsAlive(owner) ? 'active' : 'none'; } catch { return 'active'; }
}

export function readWorkspaceProjection(context: WorkspaceProjectionContext): WorkspaceProjection {
  let envelope: typeof Envelope.Type | undefined;
  let refreshOwner: 'active' | 'none';
  try { envelope = readEnvelope(context); refreshOwner = workspaceRefreshOwner(context); }
  catch (cause) {
    const error = failure(cause);
    throw new ConcordError('WorkspaceProjectionUnavailable', 'Workspace cache is unavailable. Retry refresh; repair native installation or clear the cache if indicated, then restart View.', { reason: cause instanceof HawdbFailure ? cause.code : cause instanceof ConcordError ? cause.code : 'WorkspaceProjectionInvalid', message: error.message });
  }
  if (!envelope?.record) {
    if (envelope?.error?.code === 'RecoveryRequired') throw new ConcordError('RecoveryRequired', envelope.error.message);
    throw new ConcordError('WorkspaceProjectionPending', 'No readable workspace projection. Start View and wait for the background build.', { refreshOwner, ...(envelope?.error ? { lastError: envelope.error } : {}) });
  }
  const { snapshot, ...record } = envelope.record;
  return { snapshot, projection: { ...record, current: false, refreshOwner,
    status: envelope.error?.code === 'RecoveryRequired' ? 'blocked' : envelope.error ? 'refresh-failed' : 'ready',
    ...(envelope.error ? { lastError: envelope.error } : {}), ...(envelope.lastAttempt ? { lastAttempt: envelope.lastAttempt } : {}) } };
}

/** Called only by the refresh lease owner after candidate and identity validation. */
export function storeWorkspaceProjection(context: WorkspaceProjectionContext, candidate?: WorkspaceProjectionRecord, error?: ConcordError): void {
  const path = cacheDatabasePath(context.privateDir);
  assertLeasePath(path); assertCacheDatabaseSafe(path);
  const database = openHawdb(path, { readOnly: false, create: true });
  try {
    let prior: typeof Envelope.Type | undefined;
    const payload = database.get('workspace_projection', [key])[0]?.payload;
    if (payload) { try { const parsed = decodeEnvelope(JSON.parse(payload)); if (parsed.identity === context.identity) prior = parsed; } catch { /* Invalid payload is replaced, never served. */ } }
    const next = candidate === undefined ? undefined : decodeWorkspaceProjectionRecord(candidate);
    const retain = next !== undefined && !next.consistent && prior?.record?.consistent === true;
    const record = retain || next === undefined ? prior?.record : next;
    const lastAttempt = next ? { at: next.builtUntil, complete: next.complete, changedPaths: next.changedPaths } : prior?.lastAttempt;
    const refreshError = error ?? (retain ? new ConcordError('WorkspaceProjectionDrift', 'Sources changed during refresh; retained the last consistent navigation') : undefined);
    const envelope = decodeEnvelope({ format: 'concord.workspace-projection/v1', identity: context.identity,
      ...(record ? { record } : {}), ...(lastAttempt ? { lastAttempt } : {}),
      ...(refreshError ? { error: { failedAt: new Date().toISOString(), code: refreshError.code, message: refreshError.message.slice(0, 4096) } } : {}) });
    const serialized = JSON.stringify(envelope);
    if (Buffer.byteLength(serialized) + Buffer.byteLength(key) + Buffer.byteLength('workspace_projection') > WORKSPACE_PROJECTION_LIMIT) throw new ConcordError('WorkspaceProjectionOutputLimit', 'Workspace projection exceeds its 8 MiB budget');
    database.put('workspace_projection', [{ key, payload: serialized }]);
  } finally { database.close(); }
}
