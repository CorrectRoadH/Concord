// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { Effect, Schema } from 'effect';
import { executeViewAction, getViewGitStatus, getViewFile, validateViewRoot } from './application.js';
import { ViewScanManager } from './view-scan.js';
import { closeGitBaselineCache, getGitDiff, type GitArea, type GitBaselineCache } from './git-view.js';
import { ConcordError, decode, digest, failure } from './shared.js';
import { ViewJobManager } from './view-jobs.js';
import type { ViewFailure, ViewResponse } from './view-contract.js';
import { ViewRequestLog, type RequestTiming } from './view-request-log.js';

const BODY_LIMIT = 4 * 1024 * 1024;
const STATIC_LIMIT = 16 * 1024 * 1024;
const JOB_INPUT = Schema.Struct({ caseId: Schema.String.check(Schema.isMinLength(1)) });
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
  readonly jobs: ViewJobManager;
  close(): Promise<void>;
}

export function formatViewAddress(host: string, port: number): string {
  const displayHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
  return `http://${displayHost.includes(':') ? `[${displayHost}]` : displayHost}:${port}/`;
}

function securityHeaders(response: ServerResponse): void {
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Cache-Control', 'no-store');
}

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

function json(response: ServerResponse, status: number, value: ViewResponse<unknown>): void {
  securityHeaders(response);
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(`${JSON.stringify(value)}\n`);
}

const success = (response: ServerResponse, value: unknown, status = 200): void => json(response, status, { ok: true, value });

function statusFor(error: ConcordError): number {
  if (error.code === 'ForbiddenAuthority') return 403;
  if (error.code === 'BodyTooLarge') return 413;
  if (['RepositoryBusy', 'RecoveryRequired', 'RecoveryConflict', 'PreimageChanged', 'ProjectExists', 'DocumentExists', 'DecisionExists', 'DecisionSourceUncommitted', 'DuplicatePromotion', 'DuplicateLink', 'InvalidMemoryState', 'InvalidRoadmapState', 'InvalidIssueState', 'OpenProblem', 'JobBusy', 'CleanupFailed', 'ServerStopping', 'CodeSourceChanged'].includes(error.code)) return 409;
  if (error.code === 'FileNotFound' || error.code === 'JobNotFound' || error.code === 'GitChangeNotFound' || error.code === 'ApiNotFound') return 404;
  return 400;
}

function failed(request: IncomingMessage, response: ServerResponse, cause: unknown): void {
  const error = failure(cause);
  const value: ViewFailure = { ok: false, error: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) };
  const status = statusFor(error);
  // Error details are returned to the caller, not copied into request logs.
  process.stderr.write(`Concord view error ${JSON.stringify({ status, code: error.code })}\n`);
  if (!response.destroyed) json(response, status, value);
}

interface Authority {
  readonly hostname: string;
  readonly port?: number;
}

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

function serveP5Frame(request: IncomingMessage, response: ServerResponse, webRoot: string): void {
  const target = join(webRoot, 'p5-runtime.js');
  const stat = lstatSync(target, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size > STATIC_LIMIT) throw new ConcordError('P5RuntimeMissing', 'The packaged p5 runtime is unavailable');
  securityHeaders(response);
  response.setHeader('Content-Security-Policy', "sandbox allow-scripts allow-downloads; default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; style-src 'unsafe-inline' blob: data:; img-src data: blob:; media-src data: blob:; font-src data: blob:; connect-src data: blob:; worker-src blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'");
  response.setHeader('X-Frame-Options', 'SAMEORIGIN');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()');
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  const runtime = readFileSync(target, 'utf8').replace(/<\/script/giu, '<\\/script');
  sendCompressible(request, response, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html{background:white;color:#171717}body{margin:8px;font-family:system-ui;min-height:84px}canvas{display:block;max-width:100%;height:auto}</style></head><body><script>${runtime}</script></body></html>`);
}

async function api(request: IncomingMessage, response: ServerResponse, url: URL, root: string, jobs: ViewJobManager, baselineCache: GitBaselineCache, scans: ViewScanManager, runAction: (input: unknown, response: ServerResponse, timing: RequestTiming) => Promise<unknown>, timing: RequestTiming): Promise<void> {
  const method = request.method ?? 'GET';
  const respond = (value: unknown, status = 200) => timing.sync('http.response', () => success(response, value, status));
  if (method === 'GET' && url.pathname === '/api/workspace') {
    exactQuery(url, []);
    const controller = new AbortController();
    const cancel = () => { if (!response.writableFinished) controller.abort(); };
    response.once('close', cancel);
    if (response.destroyed) controller.abort();
    const scan = await timing.async('http.workspace', () => scans.scan(controller.signal)).finally(() => response.off('close', cancel));
    for (const phase of scan.phases) timing.record(phase.name, phase.ms);
    for (const observation of scan.observations) timing.observations.add(observation);
    Object.assign(timing.caches, scan.caches);
    const body = `${scan.body}\n`;
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
  if (method === 'GET' && url.pathname === '/api/file') {
    exactQuery(url, ['path']);
    return respond(await timing.async('http.file', () => Effect.runPromise(getViewFile(root, url.searchParams.get('path')!, timing))));
  }
  if (method === 'POST' && url.pathname === '/api/p5/compile') {
    exactQuery(url, []);
    mutationJson(request);
    const input = await readJson(request);
    const { compileP5 } = await import('./p5-compiler.js');
    return respond(await Effect.runPromise(compileP5(root, input)));
  }
  if (method === 'POST' && url.pathname === '/api/action') {
    exactQuery(url, []);
    mutationJson(request);
    const input = await timing.async('http.readBody', () => readJson(request));
    return respond(await timing.async('http.action', () => runAction(input, response, timing)));
  }
  if (method === 'GET' && url.pathname === '/api/jobs') {
    exactQuery(url, []);
    return respond(timing.sync('http.jobs', () => jobs.list()));
  }
  if (method === 'POST' && url.pathname === '/api/jobs') {
    exactQuery(url, []);
    mutationJson(request);
    const input = decode(JOB_INPUT, await timing.async('http.readBody', () => readJson(request)), 'job request');
    return respond(timing.sync('http.startJob', () => jobs.start(input.caseId)), 202);
  }
  const cancel = /^\/api\/jobs\/(ccjob_[0-9a-f-]+)$/u.exec(url.pathname);
  if (method === 'DELETE' && cancel !== null) {
    exactQuery(url, []);
    return respond(timing.sync('http.cancelJob', () => jobs.cancel(cancel[1]!)));
  }
  if (method === 'GET' && url.pathname === '/api/git') {
    exactQuery(url, []);
    return respond(await timing.async('http.git', () => Effect.runPromise(getViewGitStatus(root, baselineCache))));
  }
  if (method === 'GET' && url.pathname === '/api/git/diff') {
    exactQuery(url, ['path', 'area']);
    const area = url.searchParams.get('area');
    if (area !== 'staged' && area !== 'unstaged' && area !== 'untracked') throw new ConcordError('InvalidInput', 'area must be staged, unstaged, or untracked');
    return respond(await timing.async('http.gitDiff', () => Effect.runPromise(getGitDiff(root, url.searchParams.get('path')!, area satisfies GitArea))));
  }
  throw new ConcordError('ApiNotFound', 'Unknown API endpoint');
}

export async function startViewServer(options: ViewServerOptions): Promise<ViewServerHandle> {
  const root = validateViewRoot(options.root);
  const host = options.host ?? '0.0.0.0';
  const requestedPort = options.port ?? 4317;
  if (!Number.isSafeInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) throw new ConcordError('InvalidPort', 'View port must be between 0 and 65535');
  const webRoot = options.webRoot ?? join(dirname(fileURLToPath(import.meta.url)), 'web');
  const jobs = new ViewJobManager(root);
  const scans = new ViewScanManager(root);
  const baselineCache: GitBaselineCache = {};
  const requestLog = new ViewRequestLog();
  let stopping = false;
  const feedbackControllers = new Set<AbortController>();
  const feedbackTasks = new Set<Promise<unknown>>();
  const runAction = (input: unknown, response: ServerResponse, timing: RequestTiming): Promise<unknown> => {
    if (stopping) throw new ConcordError('ServerStopping', 'The workbench is shutting down');
    const action = input !== null && typeof input === 'object' && 'action' in input ? input.action : undefined;
    if (action !== 'feedback.sync' && action !== 'feedback.check') return Effect.runPromise(executeViewAction(root, input, undefined, timing));
    const controller = new AbortController();
    feedbackControllers.add(controller);
    const onClose = () => { if (!response.writableFinished) controller.abort(); };
    response.once('close', onClose);
    if (response.destroyed) controller.abort();
    const task = Effect.runPromise(executeViewAction(root, input, controller.signal, timing), { signal: controller.signal });
    feedbackTasks.add(task);
    void task.finally(() => { feedbackTasks.delete(task); feedbackControllers.delete(controller); response.off('close', onClose); }).catch(() => {});
    return task;
  };
  const server = createServer((request, response) => {
    const timing = requestLog.begin(request, response);
    void (async () => {
      try {
        if (stopping) throw new ConcordError('ServerStopping', 'The workbench is shutting down');
        const url = timing.sync('http.validate', () => parseRequestTarget(request, validateAuthority(request)));
        if (['iframe', 'frame'].includes(request.headers['sec-fetch-dest'] as string) && url.pathname !== '/p5-frame') throw new ConcordError('ForbiddenAuthority', 'Only the p5 runtime may be loaded in a frame');
        if (request.method === 'GET' && url.pathname === '/p5-frame') {
          exactQuery(url, []);
          serveP5Frame(request, response, webRoot);
        } else if (url.pathname.startsWith('/api/')) {
          await api(request, response, url, root, jobs, baselineCache, scans, runAction, timing);
        } else if (request.method === 'GET') {
          timing.sync('http.static', () => serveStatic(request, response, url.pathname, webRoot));
        } else {
          throw new ConcordError('MethodNotAllowed', 'Only GET is available for the static application');
        }
      } catch (cause) { failed(request, response, cause); }
    })();
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  await new Promise<void>((resolveReady, reject) => {
    const onError = (cause: Error) => { requestLog.close(); server.off('listening', onListening); reject(failure(cause)); };
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
    jobs,
    close: () => closing ??= (async () => {
      stopping = true;
      for (const controller of feedbackControllers) controller.abort();
      const closed = new Promise<void>((resolveClosed, reject) => server.close((cause) => cause ? reject(failure(cause)) : resolveClosed()));
      server.closeIdleConnections();
      try { await Promise.allSettled([...feedbackTasks]); await Promise.all([scans.close(), jobs.close(), closed]); }
      finally { requestLog.close(); closeGitBaselineCache(baselineCache); }
    })(),
  };
  return handle;
}

export const serveViewServer = (options: ViewServerOptions, ready: (server: ViewServerHandle) => void): Effect.Effect<never, ConcordError> => Effect.acquireRelease(
  Effect.tryPromise({ try: () => startViewServer(options), catch: failure }),
  (server) => Effect.tryPromise({ try: () => server.close(), catch: failure }).pipe(Effect.orDie),
).pipe(Effect.tap((server) => Effect.sync(() => ready(server))), Effect.flatMap(() => Effect.never), Effect.scoped);
