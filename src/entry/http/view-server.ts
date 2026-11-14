import { p5ContentPolicy, p5FrameDocument, p5Sandbox } from '../../model/p5/index.ts';
import type { ApplicationRuntime } from '../../app/index.ts';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { isIP } from "node:net";
import { extname, join, resolve, sep } from "node:path";
import { builtAssetRoot, sourceInstallation, sourceWebServer, sourceP5Runtime } from "../../base/installation/index.ts";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { Schema } from "effect";
import { decodeViewAction, validateViewRoot } from "../../app/index.ts";
import type { GitArea } from "../../model/index.ts";
import { ConcordError, decode, digest, failure } from "../../model/index.ts";
import type { ViewFailure, ViewResponse } from "../../model/index.ts";
import { ViewRequestLog } from "./view-request-log.ts";
import type { RequestTiming } from "../../app/index.ts";
import type { ViewFile, WorkspaceProjection } from '../../model/index.ts';

export interface HostedViewPorts {
  readonly verify: () => Promise<void>;
  readonly workspace: () => Promise<WorkspaceProjection>;
  readonly refresh: () => void;
  readonly read: (path: string) => Promise<ViewFile>;
  readonly git: () => Promise<unknown>;
  readonly diff: (path: string, area: GitArea) => Promise<unknown>;
  readonly compile: (input: unknown) => Promise<unknown>;
  readonly action: (input: unknown, signal?: AbortSignal) => Promise<unknown>;
  readonly subscribe: (listener: (event: unknown) => void | Promise<void>) => () => void;
  readonly sse: (delta: number) => void;
}
interface ProjectionPort {
  read(): Promise<WorkspaceProjection>;
  retry(): void;
  request(explicit?: boolean): void;
  start(): void;
  close(): Promise<void>;
}

const BODY_LIMIT = 4 * 1024 * 1024;
const STATIC_LIMIT = 16 * 1024 * 1024;
const AUTHORITY_INPUT = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(260),
  Schema.isPattern(/^[\x21-\x7e]+$/u),
);
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export interface ViewServerOptions {
  readonly root: string;
  readonly host?: string;
  readonly port?: number;
  readonly webRoot?: string;
}

export interface ViewServerHandle {
  readonly root: string;
  readonly host: string;
  readonly port: number;
  readonly address: string;
  readonly server: Server;
  close(): Promise<void>;
}

// @concord-code
// @concord-implements docs/feature/web-workbench/cli.md
export function formatViewAddress(host: string, port: number): string {
  const displayHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
  return `http://${displayHost.includes(':') ? `[${displayHost}]` : displayHost}:${port}/`;
}

// @concord-code
// @concord-implements docs/feature/web-workbench/architecture.md
function securityHeaders(response: ServerResponse): void {
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Cache-Control', 'no-store');
}

// @concord-begin
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md#验收
function acceptsGzip(request: IncomingMessage): boolean {
  return /(?:^|,)\s*gzip(?:\s*;\s*q=(?!0(?:\.0*)?(?:,|$))[^,]*)?(?:,|$)/iu.test(request.headers['accept-encoding'] ?? '');
}

function sendCompressible(request: IncomingMessage, response: ServerResponse, body: string | Buffer): void {
  response.setHeader('Vary', 'Accept-Encoding');
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const output = acceptsGzip(request) && bytes.byteLength >= 1024 ? gzipSync(bytes) : bytes;
  if (output !== bytes) response.setHeader('Content-Encoding', 'gzip');
  response.setHeader('Content-Length', output.byteLength);
  response.end(output);
}
// @concord-end

// @concord-begin
// @concord-implements docs/feature/web-workbench/architecture.md
function json(response: ServerResponse, status: number, value: ViewResponse<unknown>): void {
  securityHeaders(response);
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(`${JSON.stringify(value)}\n`);
}

const success = (response: ServerResponse, value: unknown, status = 200): void => json(response, status, { ok: true, value });

function statusFor(error: ConcordError, workspace: boolean): number {
  if (error.code === 'WorkspaceProjectionPending') return 202;
  if (error.code === 'WorkspaceProjectionUnavailable') return 503;
  if (workspace && error.code === 'RecoveryRequired') return 503;
  if (error.code === 'ForbiddenAuthority') return 403;
  if (error.code === 'BodyTooLarge') return 413;
  if (['RepositoryBusy', 'RecoveryRequired', 'RecoveryConflict', 'FileChangedSinceRead', 'ProjectExists', 'DocumentExists', 'DecisionExists', 'DecisionSourceUncommitted', 'DuplicatePromotion', 'DuplicateLink', 'InvalidMemoryState', 'InvalidRoadmapState', 'InvalidIssueState', 'OpenProblem', 'JobBusy', 'CleanupFailed', 'ServerStopping', 'CodeSourceChanged'].includes(error.code)) return 409;
  if (error.code === 'FileNotFound' || error.code === 'JobNotFound' || error.code === 'GitChangeNotFound' || error.code === 'ApiNotFound') return 404;
  return 400;
}

function failed(request: IncomingMessage, response: ServerResponse, cause: unknown, write: (line: string) => boolean): void {
  const error = failure(cause);
  const value: ViewFailure = { ok: false, ...(error.code === 'WritingBudgetExceeded' ? { complete: false as const } : {}), error: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) };
  const status = statusFor(error, request.url?.split('?')[0] === '/api/workspace');
  // Error details are returned to the caller, not copied into request logs.
  // Pending builds and short cache lock collisions are retried by the client; they are not server errors.
  const transient = error.code === 'WorkspaceProjectionPending' || error.code === 'WorkspaceProjectionUnavailable' && typeof error.details === 'object' && error.details !== null && (error.details as { reason?: unknown }).reason === 'HawdbBusy';
  if (!transient) write(`Concord view error ${JSON.stringify({ status, code: error.code })}\n`);
  if (!response.destroyed) json(response, status, value);
}
// @concord-end

interface Authority {
  readonly hostname: string;
  readonly port?: number;
}

// @concord-begin
// @concord-implements docs/feature/web-workbench/architecture.md
function forbiddenAuthority(message: string): never {
  throw new ConcordError('ForbiddenAuthority', message);
}

function headerValues(request: IncomingMessage, name: string): readonly string[] {
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLocaleLowerCase('en-US') === name) values.push(request.rawHeaders[index + 1] ?? '');
  }
  return values;
}

function parsePort(input: string | undefined): number | undefined {
  if (input === undefined) return undefined;
  if (!/^[1-9][0-9]{0,4}$/u.test(input)) return forbiddenAuthority('Host and Origin ports must use canonical decimal syntax');
  const port = Number(input);
  if (port > 65535) return forbiddenAuthority('Host and Origin ports must be between 1 and 65535');
  return port;
}

function parseAuthority(value: unknown): Authority {
  let input: string;
  try { input = Schema.decodeUnknownSync(AUTHORITY_INPUT)(value); }
  catch { return forbiddenAuthority('Host and Origin authorities must contain bounded visible ASCII'); }

  if (/[/\\@?#,]/u.test(input)) return forbiddenAuthority('Host and Origin authorities must not contain userinfo, paths, or delimiters');
  if (input.startsWith('[')) {
    const match = /^\[([^\]]+)\](?::([^:]+))?$/u.exec(input);
    if (match === null || isIP(match[1]!) !== 6) return forbiddenAuthority('IPv6 Host and Origin authorities must use bracketed IPv6 syntax');
    const normalized = new URL(`http://[${match[1]!}]/`).hostname;
    return { hostname: normalized, port: parsePort(match[2]) };
  }

  if (input.includes('[') || input.includes(']')) return forbiddenAuthority('IPv6 Host and Origin authorities must use bracketed IPv6 syntax');
  const colon = input.indexOf(':');
  if (colon !== input.lastIndexOf(':')) return forbiddenAuthority('IPv6 Host and Origin authorities must use bracketed IPv6 syntax');
  const rawHostname = colon === -1 ? input : input.slice(0, colon);
  const port = parsePort(colon === -1 ? undefined : input.slice(colon + 1));
  const hostname = rawHostname.toLocaleLowerCase('en-US');
  if (isIP(hostname) === 4) return { hostname, port };
  if (hostname.length > 253 || hostname.split('.').some((label) => label.length === 0 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label))) {
    return forbiddenAuthority('Host and Origin must use a valid DNS name, IPv4 address, or bracketed IPv6 address');
  }
  try {
    if (new URL(`http://${hostname}/`).hostname !== hostname) return forbiddenAuthority('Host and Origin names must use canonical DNS or IPv4 syntax');
  } catch {
    return forbiddenAuthority('Host and Origin must use a valid DNS name, IPv4 address, or bracketed IPv6 address');
  }
  return { hostname, port };
}

function effectivePort(authority: Authority, protocol: 'http' | 'https'): number {
  return authority.port ?? (protocol === 'https' ? 443 : 80);
}

function validateAuthority(request: IncomingMessage): string {
  const hosts = headerValues(request, 'host');
  if (hosts.length !== 1) return forbiddenAuthority('Requests must contain exactly one Host header');
  const rawHost = hosts[0]!;
  const host = parseAuthority(rawHost);

  const origins = headerValues(request, 'origin');
  if (origins.length > 1) return forbiddenAuthority('Requests must not contain multiple Origin headers');
  if (origins.length === 1) {
    const match = /^(http|https):\/\/([^/?#\\]+)$/u.exec(origins[0]!);
    if (match === null) return forbiddenAuthority('Origin must be an http or https origin without a path');
    const protocol = match[1]! as 'http' | 'https';
    const origin = parseAuthority(match[2]!);
    if (origin.hostname !== host.hostname || effectivePort(origin, protocol) !== effectivePort(host, protocol)) {
      return forbiddenAuthority('Origin must match the Host authority; reverse proxies must preserve the external Host header');
    }
  }
  return rawHost;
}

function parseRequestTarget(request: IncomingMessage, hostAuthority: string): URL {
  const target = request.url;
  if (target === undefined || target.length > 16 * 1024 || !target.startsWith('/') || target.startsWith('//') || target.includes('\\') || target.includes('#') || /[\x00-\x1f\x7f]/u.test(target)) {
    throw new ConcordError('InvalidUrl', 'Request target must use bounded origin-form syntax');
  }
  try {
    const base = new URL(`http://${hostAuthority}/`);
    const parsed = new URL(target, base);
    if (parsed.origin !== base.origin) throw new ConcordError('InvalidUrl', 'Request target must not change authority');
    return parsed;
  } catch (cause) {
    if (cause instanceof ConcordError) throw cause;
    throw new ConcordError('InvalidUrl', 'Request target must contain a valid origin-form URL');
  }
}
// @concord-end

// @concord-begin
// @concord-implements docs/feature/web-workbench/architecture.md
function mutationJson(request: IncomingMessage): void {
  const contentType = request.headers['content-type'];
  if (typeof contentType !== 'string' || !/^application\/json(?:\s*;|$)/iu.test(contentType)) throw new ConcordError('InvalidContentType', 'Mutation requests require application/json');
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const length = Number(request.headers['content-length'] ?? '0');
  if (Number.isFinite(length) && length > BODY_LIMIT) throw new ConcordError('BodyTooLarge', 'Request body exceeds 4 MiB');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    size += chunk.byteLength;
    if (size > BODY_LIMIT) throw new ConcordError('BodyTooLarge', 'Request body exceeds 4 MiB');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
  catch { throw new ConcordError('InvalidJson', 'Request body must contain valid JSON'); }
}

function exactQuery(url: URL, names: readonly string[]): void {
  const expected = new Set(names);
  for (const name of url.searchParams.keys()) if (!expected.has(name) || url.searchParams.getAll(name).length !== 1) throw new ConcordError('InvalidQuery', 'Unexpected or repeated query parameter');
  for (const name of names) if (!url.searchParams.has(name)) throw new ConcordError('InvalidQuery', `Missing query parameter: ${name}`);
}
// @concord-end

// @concord-code
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md#验收
function serveStatic(request: IncomingMessage, response: ServerResponse, pathname: string, webRoot: string): void {
  const index = join(webRoot, 'index.html');
  let target = index;
  if (pathname.startsWith('/assets/')) {
    const relative = pathname.slice(1);
    target = resolve(webRoot, relative);
    if (!target.startsWith(`${resolve(webRoot)}${sep}`)) throw new ConcordError('UnsafePath', 'Static asset path escaped the web bundle');
    if (!existsSync(target)) throw new ConcordError('FileNotFound', 'Static asset not found');
  }
  if (!existsSync(target)) throw new ConcordError('WebBundleMissing', 'The built web application is unavailable; run the package build');
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > STATIC_LIMIT) throw new ConcordError('InvalidFile', 'Web assets must be bounded regular files');
  securityHeaders(response);
  response.statusCode = 200;
  const contentType = CONTENT_TYPES[extname(target)] ?? 'application/octet-stream';
  response.setHeader('Content-Type', contentType);
  if (pathname.startsWith('/assets/')) response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  const body = readFileSync(target);
  if (/^(?:text\/|application\/json)/u.test(contentType)) sendCompressible(request, response, body);
  else { response.setHeader('Content-Length', body.byteLength); response.end(body); }
}

// @concord-code
// @concord-implements docs/feature/web-workbench/architecture.md#p5-图解
function serveP5Frame(request: IncomingMessage, response: ServerResponse, webRoot: string, sourceRuntime?: string): void {
  const target = join(webRoot, 'p5-runtime.js');
  const stat = lstatSync(target, { throwIfNoEntry: false });
  if (sourceRuntime === undefined && (!stat?.isFile() || stat.isSymbolicLink() || stat.size > STATIC_LIMIT)) throw new ConcordError('P5RuntimeMissing', 'The packaged p5 runtime is unavailable');
  securityHeaders(response);
  response.setHeader('Content-Security-Policy', `sandbox ${p5Sandbox}; ${p5ContentPolicy}; frame-ancestors 'self'`);
  response.setHeader('X-Frame-Options', 'SAMEORIGIN');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()');
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  sendCompressible(request, response, p5FrameDocument(sourceRuntime ?? readFileSync(target, 'utf8')));
}

// @concord-code
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md#主流程
async function api(request: IncomingMessage, response: ServerResponse, url: URL, root: string, scans: ProjectionPort, runAction: (input: unknown, response: ServerResponse, timing: RequestTiming) => Promise<unknown>, timing: RequestTiming, hosted: HostedViewPorts): Promise<void> {
  const method = request.method ?? 'GET';
  const respond = (value: unknown, status = 200) => timing.sync('http.response', () => success(response, value, status));
  if (method === 'GET' && url.pathname === '/api/events') {
    exactQuery(url, []); securityHeaders(response);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Connection', 'keep-alive'); response.flushHeaders();
    let pending: string | undefined, blocked = false;
    const send = (event: unknown) => {
      if (response.writableEnded || response.destroyed) return;
      const stopping = typeof event === 'object' && event !== null && 'state' in event && event.state === 'stopping';
      const body = `event: ${stopping ? 'stopping' : 'workspace'}\ndata: ${JSON.stringify(event)}\n\n`;
      if (stopping) return new Promise<void>(resolve => {
        response.once('finish', resolve); response.once('close', resolve); response.end(body);
      });
      if (blocked) { pending = body; return; }
      blocked = !response.write(body);
    };
    const drain = () => { if (response.writableEnded || response.destroyed) return; blocked = false; if (pending) { const body = pending; pending = undefined; blocked = !response.write(body); } };
    response.on('drain', drain);
    hosted.sse(1);
    const unsubscribe = hosted.subscribe(send);
    response.once('close', () => { pending = undefined; response.off('drain', drain); unsubscribe(); hosted.sse(-1); });
    return;
  }
  if (method === 'GET' && url.pathname === '/api/workspace') {
    exactQuery(url, []);
    let value;
    try { value = await timing.async('http.workspaceCache', () => scans.read()); }
    catch (cause) {
      if (cause instanceof ConcordError && cause.code === 'RecoveryRequired') return json(response, 503, { ok: false, error: cause.code, message: cause.message });
      throw cause;
    }
    const body = `${JSON.stringify({ ok: true, value })}\n`;
    const etag = `"${digest(body)}"`;
    securityHeaders(response);
    response.setHeader('ETag', etag);
    response.setHeader('Vary', 'Accept-Encoding');
    if (request.headers['if-none-match'] === etag) {
      response.statusCode = 304;
      response.end();
    } else {
      response.statusCode = 200;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      timing.sync('http.compressResponse', () => sendCompressible(request, response, body));
    }
    return;
  }
  if (method === 'POST' && url.pathname === '/api/workspace') {
    exactQuery(url, []);
    mutationJson(request);
    decode(Schema.Record(Schema.String, Schema.Never), await readJson(request), 'workspace refresh');
    scans.retry();
    return respond({ status: 'requested' }, 202);
  }
  if (method === 'GET' && url.pathname === '/api/file') {
    exactQuery(url, ['path']);
    return respond(await timing.async('http.file', () => hosted.read(url.searchParams.get('path')!)));
  }
  if (method === 'POST' && url.pathname === '/api/p5/compile') {
    exactQuery(url, []);
    mutationJson(request);
    const input = await readJson(request);
    return respond(await hosted.compile(input));
  }
  if (method === 'POST' && url.pathname === '/api/action') {
    exactQuery(url, []);
    mutationJson(request);
    const input = decodeViewAction(await timing.async('http.readBody', () => readJson(request)));
    const result = await timing.async('http.action', () => runAction(input, response, timing));
    if (typeof result === 'object' && result !== null && ('changedPaths' in result && Array.isArray(result.changedPaths) && result.changedPaths.length > 0 && !('dryRun' in result && result.dryRun)
      || ['recover', 'feedback.sync', 'cache.clear', 'cache.rebuild'].includes(input.action) && !('dryRun' in input && input.dryRun))) scans.request(true);
    return respond(result);
  }
  if (method === 'GET' && url.pathname === '/api/git') {
    exactQuery(url, []);
    return respond(await timing.async('http.git', () => hosted.git()));
  }
  if (method === 'GET' && url.pathname === '/api/git/diff') {
    exactQuery(url, ['path', 'area']);
    const area = url.searchParams.get('area');
    if (area !== 'staged' && area !== 'unstaged' && area !== 'untracked') throw new ConcordError('InvalidInput', 'area must be staged, unstaged, or untracked');
    return respond(await timing.async('http.gitDiff', () => hosted.diff(url.searchParams.get('path')!, area)));
  }
  throw new ConcordError('ApiNotFound', 'Unknown API endpoint');
}

// @concord-code
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md#主流程
// @concord-implements docs/feature/web-workbench/architecture.md
async function startViewServer(options: ViewServerOptions, scans: ProjectionPort, hosted: HostedViewPorts, runtime: ApplicationRuntime, write: (line: string) => boolean): Promise<ViewServerHandle> {
  const root = validateViewRoot(options.root, runtime);
  const host = options.host ?? '127.0.0.1';
  const requestedPort = options.port ?? 4317;
  if (!Number.isSafeInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) throw new ConcordError('InvalidPort', 'View port must be between 0 and 65535');
  const webRoot = options.webRoot ?? builtAssetRoot('web');
  const sourceWeb = sourceInstallation && options.webRoot === undefined ? await sourceWebServer(runtime) : undefined;
  let p5Runtime: Promise<string> | undefined;
  const requestLog = new ViewRequestLog(write);
  let stopping = false;
  const activeResponses = new Set<ServerResponse>();
  const feedbackControllers = new Set<AbortController>();
  const feedbackTasks = new Set<Promise<unknown>>();
  const runAction = (input: unknown, response: ServerResponse, timing: RequestTiming): Promise<unknown> => {
    if (stopping) throw new ConcordError('ServerStopping', 'The workbench is shutting down');
    const action = input !== null && typeof input === 'object' && 'action' in input ? input.action : undefined;
    if (action !== 'feedback.sync' && action !== 'feedback.check') return hosted.action(input);
    const controller = new AbortController();
    feedbackControllers.add(controller);
    const onClose = () => { if (!response.writableFinished) controller.abort(); };
    response.once('close', onClose);
    if (response.destroyed) controller.abort();
    const task = hosted.action(input, controller.signal);
    feedbackTasks.add(task);
    void task.finally(() => { feedbackTasks.delete(task); feedbackControllers.delete(controller); response.off('close', onClose); }).catch(() => {});
    return task;
  };
  const server = createServer((request, response) => {
    activeResponses.add(response);
    response.once('close', () => activeResponses.delete(response));
    response.once('finish', () => activeResponses.delete(response));
    const timing = requestLog.begin(request, response);
    void (async () => {
      try {
        if (stopping) throw new ConcordError('ServerStopping', 'The workbench is shutting down');
        const url = timing.sync('http.validate', () => parseRequestTarget(request, validateAuthority(request)));
        await hosted.verify();
        if (['iframe', 'frame'].includes(request.headers['sec-fetch-dest'] as string) && url.pathname !== '/p5-frame') throw new ConcordError('ForbiddenAuthority', 'Only the p5 runtime may be loaded in a frame');
        if (request.method === 'GET' && url.pathname === '/p5-frame') {
          exactQuery(url, []);
          serveP5Frame(request, response, webRoot, sourceWeb === undefined ? undefined : await (p5Runtime ??= sourceP5Runtime(runtime)));
        } else if (url.pathname.startsWith('/api/')) {
          await api(request, response, url, root, scans, runAction, timing, hosted);
        } else if (request.method === 'GET') {
          if (sourceWeb === undefined) timing.sync('http.static', () => serveStatic(request, response, url.pathname, webRoot));
          else { securityHeaders(response); await timing.async('http.static', () => sourceWeb.serve(request, response, bytes => sendCompressible(request, response, bytes))); }
        } else {
          throw new ConcordError('MethodNotAllowed', 'Only GET is available for the static application');
        }
      } catch (cause) { failed(request, response, cause, write); }
    })();
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  await new Promise<void>((resolveReady, reject) => {
    const onError = (cause: Error) => { requestLog.close(); void sourceWeb?.close(); server.off('listening', onListening); reject(failure(cause)); };
    const onListening = () => { server.off('error', onError); resolveReady(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(requestedPort, host);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    requestLog.close();
    server.close();
    throw new ConcordError('ServerAddressUnavailable', 'Could not determine the view server port');
  }
  let closing: Promise<void> | undefined;
  const handle: ViewServerHandle = {
    root,
    host,
    port: address.port,
    address: formatViewAddress(host, address.port),
    server,
    close: () => closing ??= (async () => {
      stopping = true;
      for (const response of activeResponses) response.destroy();
      for (const controller of feedbackControllers) controller.abort();
      const closed = new Promise<void>((resolveClosed, reject) => server.close((cause) => cause ? reject(failure(cause)) : resolveClosed()));
      server.closeAllConnections();
      try { await Promise.allSettled([...feedbackTasks]); await Promise.all([scans.close(), closed]); }
      finally { await sourceWeb?.close(); requestLog.close(); }
    })(),
  };
  scans.start();
  return handle;
}

export const startHostedViewServer = (options: ViewServerOptions, ports: HostedViewPorts, runtime: ApplicationRuntime, write: (line: string) => boolean) => startViewServer(options, {
  read: ports.workspace, request: ports.refresh, retry: ports.refresh, start: () => {}, close: async () => {},
}, ports, runtime, write);
