import { projectConceptCatalogs } from '../model/index.js';
import { WorkspaceProjectionEnvelope as Envelope } from "../model/index.js";
import { join } from "node:path";

import { Workspace } from "../base/workspace/index.js";
import { Sources } from '../base/sources/index.js';
import { Effect } from "effect";
import { genericPrivateDirectorySync } from "../base/publication/index.js";
import { assertLeasePath, ownerIsAlive, readLeaseOwner, PUBLICATION_LEASE } from "../base/publication/index.js";
import { assertCacheDatabaseSafe, cacheDatabasePath, cacheRootOwnerOnly } from "../base/cache/index.js";
import { HawdbFailure, hawdbIdentity, PersistentCache } from "../base/cache/index.js";
import { workspaceInstallationIdentity } from "../base/installation/index.js";
import { requestCacheMaintenance } from "../base/cache/index.js";
import { ConcordError, digest, failure } from "../model/index.js";


import type { WorkspaceProjection, WorkspaceSnapshot } from "../model/index.js";

const key = 'workspace';
import { type WorkspaceProjectionRecord, type WorkspaceProjectionContext, WORKSPACE_PROJECTION_LIMIT, decodeEnvelope, decodeWorkspaceProjectionRecord } from "../model/index.js";

export const assertWorkspacePublicationReady = Effect.fn('workspaceProjection.publicationReady')(function*(context: WorkspaceProjectionContext) {
  const pending = yield* (yield* Sources).pendingPublications(context.privateDir);
  if (pending.length === 0) return;
  const live = yield* Effect.try({ try: () => {
    const owner = readLeaseOwner(join(context.privateDir, 'trace', PUBLICATION_LEASE), 'workspace-publication');
    return owner !== undefined && owner.root === context.root && ownerIsAlive(owner);
  }, catch: failure });
  return yield* Effect.fail(new ConcordError(live ? 'RepositoryBusy' : 'RecoveryRequired', live ? 'Publication is still running; discard the candidate and retry' : 'An interrupted publication exists; run concord recover'));
});

export const workspaceProjectionContext = Effect.fn('workspaceProjectionContext')(function*(input: string) {
  const workspace = yield* Workspace;
  const { root, privateDir, config } = yield* workspace.identify(input, true, true);
  const installation = yield* Effect.try({ try: workspaceInstallationIdentity, catch: failure });
  return { root, privateDir, identity: digest(JSON.stringify([root, privateDir, config ?? 'absent', 'workspace', installation])) } satisfies WorkspaceProjectionContext;
}, Effect.mapError(cause => new ConcordError('WorkspaceProjectionUnavailable', 'Cannot identify the workspace cache; repair the configuration path or installation and restart View', {
  reason: cause.code, message: cause.message,
})));


/** Explicit construction, followed by strict decoding, keeps source bodies out of persistent storage. */
export function makeWorkspaceProjectionRecord(snapshot: WorkspaceSnapshot, drift: { files: readonly string[]; directories: readonly string[]; publicationChanged: boolean }, builtFrom: string): WorkspaceProjectionRecord {
  const remote = <T extends { readonly body: string }>(value: T) => { const { body: _body, ...rest } = value; return rest; };
  const document = (value: WorkspaceSnapshot['documents'][number]) => ({ path: value.path, digest: value.digest,
    metadata: value.metadata.kind === 'issue' && value.metadata.source ? { ...value.metadata, source: remote(value.metadata.source) } : value.metadata });
  const directory = projectConceptCatalogs(snapshot.pages);
  const snapshotComplete = snapshot.complete === true && directory.findings.length === 0;
  const changedPaths = [...new Set([...drift.files, ...drift.directories, ...(drift.publicationChanged ? ['.'] : [])])].sort();
  const consistent = changedPaths.length === 0;
  const builtUntil = new Date().toISOString();
  const diagnostics = snapshot.diagnostics;
  // Error details may contain arbitrary source material. Only diagnostic fields are retained.
  const diagnostic = typeof diagnostics === 'object' && diagnostics !== null && 'error' in diagnostics
    ? { ...('ok' in diagnostics ? { ok: diagnostics.ok } : {}), error: diagnostics.error, message: 'message' in diagnostics ? diagnostics.message : '' }
    : diagnostics;
  return decodeWorkspaceProjectionRecord({ builtAt: builtUntil, builtFrom, builtUntil, consistent,
    complete: consistent && snapshotComplete, changedPaths, unknownRelations: !consistent || !snapshotComplete,
    snapshot: { ...snapshot, complete: consistent && snapshotComplete, diagnostics: diagnostic, conceptCatalogs: directory.catalogs, findings: [...snapshot.findings, ...directory.findings],
      documents: snapshot.documents.map(document),
      pages: snapshot.pages.map(page => ({ path: page.path, digest: page.digest, ...(page.documentPath ? { documentPath: page.documentPath } : {}),
        ...(page.body.match(/^#\s+(.+)$/mu)?.[1] ? { derivedTitle: page.body.match(/^#\s+(.+)$/mu)![1]!.trim() } : {}) })),
      feedback: snapshot.feedback.map(item => ({ ...item, document: document(item.document), remote: item.remote ? remote(item.remote) : null })),
    },
  });
}


const readEnvelope = Effect.fn('workspaceProjection.readEnvelope')(function*(context: WorkspaceProjectionContext) {
  yield* Effect.try({ try: hawdbIdentity, catch: cause => cause });
  const cache = yield* PersistentCache;
  const rows = yield* cache.read(context.privateDir, 'workspace_projection', [key]);
  return yield* Effect.try({ try: () => {
    const payload = rows[0]?.payload;
    if (payload === undefined) return undefined;
    if (Buffer.byteLength(payload) > WORKSPACE_PROJECTION_LIMIT) throw new ConcordError('WorkspaceProjectionOutputLimit', 'Workspace projection exceeds 8 MiB');
    const envelope = decodeEnvelope(JSON.parse(payload));
    return envelope.identity === context.identity ? envelope : undefined;
  }, catch: cause => cause });
});
export function workspaceRefreshOwner(context: WorkspaceProjectionContext): 'active' | 'none' {
  const owner = readLeaseOwner(join(context.privateDir, 'workspace-refresh', 'current'), 'workspace-read');
  if (!owner) return 'none';
  try { return ownerIsAlive(owner) ? 'active' : 'none'; } catch { return 'active'; }
}
export const readWorkspaceProjection = Effect.fn('readWorkspaceProjection')(function*(context: WorkspaceProjectionContext) {
  const unavailable = (cause: unknown) => {
    const error = failure(cause);
    return new ConcordError('WorkspaceProjectionUnavailable', 'Workspace cache is unavailable. Retry refresh; repair native installation or clear the cache if indicated, then restart View.', { reason: cause instanceof HawdbFailure ? cause.code : cause instanceof ConcordError ? cause.code : 'WorkspaceProjectionInvalid', message: error.message });
  };
  const envelope = yield* readEnvelope(context).pipe(Effect.mapError(unavailable));
  const refreshOwner = yield* Effect.try({ try: () => workspaceRefreshOwner(context), catch: unavailable });
  return yield* Effect.try({ try: (): WorkspaceProjection => {
  if (!envelope?.record) {
    if (envelope?.error?.code === 'RecoveryRequired') throw new ConcordError('RecoveryRequired', envelope.error.message);
    throw new ConcordError('WorkspaceProjectionPending', 'No readable workspace projection. Start View and wait for the background build.', { refreshOwner, ...(envelope?.error ? { lastError: envelope.error } : {}) });
  }
  const { snapshot, ...record } = envelope.record;
  return { snapshot, projection: { ...record, current: false, refreshOwner,
    status: envelope.error?.code === 'RecoveryRequired' ? 'blocked' : envelope.error ? 'refresh-failed' : 'ready',
    ...(envelope.error ? { lastError: envelope.error } : {}), ...(envelope.lastAttempt ? { lastAttempt: envelope.lastAttempt } : {}) } };
  }, catch: failure });
});



/** Called only by the refresh lease owner after candidate and identity validation. */
export const storeWorkspaceProjection = Effect.fn('storeWorkspaceProjection')(function*(context: WorkspaceProjectionContext, candidate?: WorkspaceProjectionRecord, error?: ConcordError) {
  const cache = yield* PersistentCache;
  yield* cache.update(context.privateDir, 'workspace_projection', key, payload => {
    let prior: typeof Envelope.Type | undefined;
    if (payload) { try { const parsed = decodeEnvelope(JSON.parse(payload)); if (parsed.identity === context.identity) prior = parsed; } catch { /* Invalid payload is replaced, never served. */ } }
    const next = candidate === undefined ? undefined : decodeWorkspaceProjectionRecord(candidate);
    const retain = next !== undefined && !next.consistent && prior?.record?.consistent === true;
    const record = retain || next === undefined ? prior?.record : next;
    const lastAttempt = next ? { at: next.builtUntil, complete: next.complete, changedPaths: next.changedPaths } : prior?.lastAttempt;
    // A drifted attempt that keeps the last consistent generation is reported through lastAttempt, not as a failure.
    const envelope = decodeEnvelope({ format: 'concord.workspace-projection/v1', identity: context.identity,
      ...(record ? { record } : {}), ...(lastAttempt ? { lastAttempt } : {}),
      ...(error ? { error: { failedAt: new Date().toISOString(), code: error.code, message: error.message.slice(0, 4096) } } : {}) });
    const serialized = JSON.stringify(envelope);
    if (Buffer.byteLength(serialized) + Buffer.byteLength(key) + Buffer.byteLength('workspace_projection') > WORKSPACE_PROJECTION_LIMIT) throw new ConcordError('WorkspaceProjectionOutputLimit', 'Workspace projection exceeds its 8 MiB budget');
    return serialized;
  }).pipe(Effect.ensuring(Effect.sync(() => requestCacheMaintenance(context))));
});
