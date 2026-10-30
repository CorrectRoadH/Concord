import { WorkspaceProjectionEnvelope as Envelope } from "../model/index.js";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { discoverRoot } from "../base/workspace/index.js";
import { genericPrivateDirectorySync } from "../base/publication/index.js";
import { assertLeasePath, ownerIsAlive, readLeaseOwner } from "../base/publication/index.js";
import { assertCacheDatabaseSafe, cacheDatabasePath, cacheRootOwnerOnly } from "../base/cache/index.js";
import { HawdbFailure, hawdbIdentity, openHawdb } from "../base/cache/index.js";
import { workspaceInstallationIdentity } from "../base/installation/index.js";
import { requestCacheMaintenance } from "../base/cache/index.js";
import { ConcordError, digest, failure } from "../model/index.js";


import { type WorkspaceProjection, type WorkspaceSnapshot } from "../model/index.js";

const key = 'workspace';
import { type WorkspaceProjectionRecord, type WorkspaceProjectionContext, WORKSPACE_PROJECTION_LIMIT, decodeEnvelope, decodeWorkspaceProjectionRecord } from "../model/index.js";

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
  return { root, privateDir, identity: digest(JSON.stringify([root, privateDir, config, 'workspace', workspaceInstallationIdentity()])) };
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
    // A drifted attempt that keeps the last consistent generation is reported through lastAttempt, not as a failure.
    const envelope = decodeEnvelope({ format: 'concord.workspace-projection/v1', identity: context.identity,
      ...(record ? { record } : {}), ...(lastAttempt ? { lastAttempt } : {}),
      ...(error ? { error: { failedAt: new Date().toISOString(), code: error.code, message: error.message.slice(0, 4096) } } : {}) });
    const serialized = JSON.stringify(envelope);
    if (Buffer.byteLength(serialized) + Buffer.byteLength(key) + Buffer.byteLength('workspace_projection') > WORKSPACE_PROJECTION_LIMIT) throw new ConcordError('WorkspaceProjectionOutputLimit', 'Workspace projection exceeds its 8 MiB budget');
    database.put('workspace_projection', [{ key, payload: serialized }]);
  } finally { database.close(); requestCacheMaintenance(context); }
}
