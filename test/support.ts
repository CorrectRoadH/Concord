import { after as nodeAfter, before as nodeBefore } from 'node:test';
import { Effect, Schema } from 'effect';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTypeScriptConfig, renderTypeScriptConfig } from '../dist/config.js';
import { ProjectSchema, decode, type ProjectConfig } from '../dist/shared.js';
import type { WorkspaceProjection } from '../dist/view-contract.js';
import { WorkspaceProjectionSnapshotSchema } from '../dist/workspace-projection.js';

type TestEffect = Effect.Effect<void, unknown, never>;

export const effectBefore = (program: TestEffect): void => {
  nodeBefore(() => Effect.runPromise(program));
};

export const effectAfter = (program: TestEffect): void => {
  nodeAfter(() => Effect.runPromise(program));
};

export const projectConfigPath = (_root: string): 'concord.config.ts' => 'concord.config.ts';
export const readProjectConfig = (root: string): ProjectConfig => {
  const path = projectConfigPath(root), source = readFileSync(join(root, path), 'utf8');
  return parseTypeScriptConfig(source);
};
export const writeProjectConfig = (root: string, input: unknown): void => {
  const config = decode(ProjectSchema, input, 'test project configuration');
  const path = projectConfigPath(root);
  writeFileSync(join(root, path), renderTypeScriptConfig(config));
};

export interface PollOptions {
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
  readonly description?: string;
}

const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

export const pollUntil = async <T>(attempt: () => Promise<T | undefined>, options: PollOptions = {}): Promise<T> => {
  const timeoutMs = options.timeoutMs ?? 65_000;
  const intervalMs = options.intervalMs ?? 50;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await attempt();
    if (value !== undefined) return value;
    if (Date.now() >= deadline) throw new Error(`${options.description ?? 'condition'} did not become ready within ${timeoutMs}ms`);
    await sleep(intervalMs);
  }
};

const WorkspaceProjectionStatusSchema = Schema.Struct({
  status: Schema.Literals(['ready', 'refresh-failed', 'blocked']),
  current: Schema.Literal(false),
  refreshOwner: Schema.Literals(['active', 'none']),
  builtAt: Schema.String,
  builtFrom: Schema.String,
  builtUntil: Schema.String,
  consistent: Schema.Boolean,
  complete: Schema.Boolean,
  changedPaths: Schema.Array(Schema.String),
  unknownRelations: Schema.Boolean,
  lastError: Schema.optional(Schema.Struct({ failedAt: Schema.String, code: Schema.String, message: Schema.String })),
  lastAttempt: Schema.optional(Schema.Struct({ at: Schema.String, complete: Schema.Boolean, changedPaths: Schema.Array(Schema.String) })),
});
const WorkspaceProjectionSchema = Schema.Struct({ snapshot: WorkspaceProjectionSnapshotSchema, projection: WorkspaceProjectionStatusSchema });
const WorkspaceProjectionEnvelopeSchema = Schema.Struct({ ok: Schema.Literal(true), value: WorkspaceProjectionSchema });
const WorkspaceProjectionOutputSchema = Schema.Struct({ operation: Schema.Literal('workspace-projection'), ...WorkspaceProjectionSchema.fields });
const WorkspacePendingResponseSchema = Schema.Struct({
  ok: Schema.Literal(false),
  error: Schema.Literal('WorkspaceProjectionPending'),
  message: Schema.String,
  details: Schema.optional(Schema.Unknown),
});

export const parseWorkspaceProjection = (body: string): WorkspaceProjection | undefined => {
  try {
    return Schema.decodeUnknownSync(WorkspaceProjectionEnvelopeSchema, { onExcessProperty: 'error' })(JSON.parse(body)).value;
  } catch { return undefined; }
};

export const parseWorkspaceProjectionOutput = (body: string): WorkspaceProjection & { readonly operation: 'workspace-projection' } =>
  Schema.decodeUnknownSync(WorkspaceProjectionOutputSchema, { onExcessProperty: 'error' })(JSON.parse(body));

export const parseWorkspacePending = (body: string): boolean => {
  try {
    Schema.decodeUnknownSync(WorkspacePendingResponseSchema, { onExcessProperty: 'error' })(JSON.parse(body));
    return true;
  } catch { return false; }
};

export const parseWorkspaceHttpResponse = (status: number, body: string): WorkspaceProjection | undefined => {
  if (status === 202) {
    if (!parseWorkspacePending(body)) throw new Error(`GET /api/workspace returned malformed 202: ${body}`);
    return undefined;
  }
  if (status !== 200) throw new Error(`GET /api/workspace returned HTTP ${status}: ${body}`);
  const projection = parseWorkspaceProjection(body);
  if (projection === undefined) throw new Error(`GET /api/workspace returned malformed HTTP 200: ${body}`);
  return projection;
};

const readWorkspaceProjectionResponse = async (response: Response): Promise<WorkspaceProjection | undefined> => {
  const body = await response.text();
  if (response.status === 503) {
    const busy = Schema.Struct({ ok: Schema.Literal(false), error: Schema.Literal('WorkspaceProjectionUnavailable'), message: Schema.String,
      details: Schema.Struct({ reason: Schema.Literal('HawdbBusy'), message: Schema.String }) });
    if (Schema.is(busy)(JSON.parse(body))) return undefined;
  }
  return parseWorkspaceHttpResponse(response.status, body);
};

/** Polls a real View server until a readable generation exists, never weakening the first-build 202. */
export const waitForWorkspaceProjection = (base: string, options: PollOptions = {}): Promise<WorkspaceProjection> =>
  pollUntil(async () => {
    return readWorkspaceProjectionResponse(await fetch(`${base}/api/workspace`));
  }, { description: 'workspace projection', ...options });

export const fetchWorkspaceProjection = async (base: string): Promise<WorkspaceProjection> => {
  const value = await readWorkspaceProjectionResponse(await fetch(`${base}/api/workspace`));
  if (value === undefined) throw new Error('Workspace projection is pending');
  return value;
};

/**
 * Resolves the ETag once `If-None-Match` reliably returns 304. The lease owner
 * field can settle just after the first generation is published, so a single
 * request pair is not enough to observe a stable digest.
 */
export const waitForWorkspaceNotModified = async (base: string, options: PollOptions = {}): Promise<string> => {
  let etag: string | undefined;
  await pollUntil(async () => {
    const response = await fetch(`${base}/api/workspace`);
    if (response.status !== 200) { await response.arrayBuffer(); return undefined; }
    const candidate = response.headers.get('etag');
    await response.arrayBuffer();
    if (candidate === null) return undefined;
    const cached = await fetch(`${base}/api/workspace`, { headers: { 'If-None-Match': candidate } });
    if (cached.status !== 304) { await cached.arrayBuffer(); return undefined; }
    await cached.arrayBuffer();
    etag = candidate;
    return true;
  }, { description: 'workspace not-modified response', ...options });
  return etag!;
};
