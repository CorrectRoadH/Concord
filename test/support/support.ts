import { tmpdir } from './temporary.ts';
import { after as nodeAfter, before as nodeBefore } from 'node:test';
import { Effect, Schema } from 'effect';
import { sourceCli } from './source-consumer.ts';
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import type { Transform } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { parseTypeScriptConfig, renderTypeScriptConfig } from "../../src/base/workspace/index.ts";
import { ProjectSchema, decode, type shared_ProjectConfig as ProjectConfig } from "../../src/model/index.ts";
import { type WorkspaceProjection } from "../../src/model/index.ts";
import { WorkspaceProjectionSnapshotSchema } from "../../src/model/index.ts";

type TestEffect = Effect.Effect<void, unknown, never>;

const decoders: Readonly<Record<string, () => Transform>> = { gzip: createGunzip, 'x-gzip': createGunzip, deflate: createInflate, br: createBrotliDecompress };
const bodylessStatus = new Set([101, 204, 205, 304]);

/**
 * fetch-compatible request on a fresh connection. A stalled test event loop can
 * outlive the server's keep-alive window, so reused sockets reset mid-request.
 */
export const fetchFresh = (input: string | URL, init: RequestInit = {}): Promise<Response> => new Promise((resolveResponse, reject) => {
  const signal = init.signal ?? undefined;
  if (signal?.aborted) { reject(signal.reason); return; }
  const url = new URL(input);
  const headers = new Headers(init.headers);
  if (init.body != null && typeof init.body !== 'string') { reject(new TypeError('fetchFresh accepts string bodies only')); return; }
  const body = typeof init.body === 'string' ? Buffer.from(init.body) : undefined;
  if (body !== undefined && !headers.has('content-length')) headers.set('content-length', String(body.byteLength));
  const call = httpRequest(url, { method: init.method ?? 'GET', headers: Object.fromEntries(headers), agent: false }, (response) => {
    const chunks: Buffer[] = [];
    const encoding = String(response.headers['content-encoding'] ?? '').trim().toLowerCase();
    const stream = decoders[encoding] === undefined ? response : response.pipe(decoders[encoding]());
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.once('error', cause => reject(new TypeError('fetch failed', { cause })));
    stream.once('end', () => {
      const status = response.statusCode ?? 0;
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) responseHeaders.append(name, item);
      }
      const content = bodylessStatus.has(status) || (init.method ?? 'GET') === 'HEAD' ? null : Buffer.concat(chunks);
      resolveResponse(new Response(content, { status, statusText: response.statusMessage ?? '', headers: responseHeaders }));
    });
  });
  const abort = () => { call.destroy(); reject(signal!.reason); };
  signal?.addEventListener('abort', abort, { once: true });
  call.once('close', () => signal?.removeEventListener('abort', abort));
  call.once('error', cause => { if (!signal?.aborted) reject(new TypeError('fetch failed', { cause })); });
  call.end(body);
});

export const effectBefore = (program: TestEffect): void => {
  nodeBefore(() => Effect.runPromise(program));
};

export const effectAfter = (program: TestEffect): void => {
  nodeAfter(() => Effect.runPromise(program));
};

export const projectConfigPath = (_root: string): 'concord.config.ts' => 'concord.config.ts';
export const readProjectConfig = (root: string): ProjectConfig => {
  const path = projectConfigPath(root);
  if (!existsSync(join(root, path))) return {};
  const source = readFileSync(join(root, path), 'utf8');
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

class PollTimeout extends Schema.TaggedError<PollTimeout>()('PollTimeout', {
  message: Schema.String,
  timeoutMs: Schema.Number,
}) {}

export const pollUntil = <T>(attempt: (signal: AbortSignal) => Promise<T | undefined>, options: PollOptions = {}): Promise<T> => {
  const timeoutMs = options.timeoutMs ?? 65_000;
  const intervalMs = options.intervalMs ?? 50;
  return Effect.runPromise(Effect.gen(function* () {
    for (;;) {
      const value = yield* Effect.tryPromise({ try: attempt, catch: cause => cause });
      if (value !== undefined) return value;
      yield* Effect.sleep(intervalMs);
    }
  }).pipe(Effect.timeoutOrElse({
    duration: timeoutMs,
    orElse: () => Effect.fail(new PollTimeout({
      message: `${options.description ?? 'condition'} did not become ready within ${timeoutMs}ms`, timeoutMs,
    })),
  })));
};

const WorkspaceProjectionStatusSchema = Schema.Struct({
  sourceDigest: Schema.String,
  status: Schema.Literals(['ready', 'refresh-failed', 'blocked']),
  current: Schema.Literal(false),
  refreshOwner: Schema.Literals(['active', 'none']),
  builtAt: Schema.String,
  builtFrom: Schema.String,
  builtUntil: Schema.String,
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
  pollUntil(async signal => {
    return readWorkspaceProjectionResponse(await fetchFresh(`${base}/api/workspace`, { signal }));
  }, { description: 'workspace projection', ...options });

export const fetchWorkspaceProjection = async (base: string): Promise<WorkspaceProjection> => {
  const value = await readWorkspaceProjectionResponse(await fetchFresh(`${base}/api/workspace`, { signal: AbortSignal.timeout(10_000) }));
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
  await pollUntil(async signal => {
    const response = await fetchFresh(`${base}/api/workspace`, { signal });
    const candidate = response.headers.get('etag');
    const value = await readWorkspaceProjectionResponse(response);
    if (value === undefined || candidate === null) return undefined;
    const cached = await fetchFresh(`${base}/api/workspace`, { headers: { 'If-None-Match': candidate }, signal });
    if (cached.status !== 304) { await readWorkspaceProjectionResponse(cached); return undefined; }
    await cached.arrayBuffer();
    etag = candidate;
    return true;
  }, { description: 'workspace not-modified response', ...options });
  return etag!;
};

/** Product subprocesses run the checkout's source CLI. */
export function installedConcordCli(): string {
  return sourceCli();
}
