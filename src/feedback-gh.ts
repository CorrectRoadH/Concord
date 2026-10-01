// @concord-file
// @concord-implements docs/feature/neutral-project-governance/use-case/mutate-remote-issue.md
// @concord-implements docs/feature/feedback/use-case/triage-feedback.md
import { accessSync, constants, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DateTime, Effect, Schema } from 'effect';
import { fetchFeedback, type FeedbackFetch, type FeedbackTransport } from './feedback-providers.js';
import type { FeedbackConnection } from './feedback-schema.js';
import { hasConfirmedOwnedGroupCleanup, makeOwnedProcessService } from './owned-process.js';
import { ConcordError } from './shared.js';

type GhConnection = Extract<FeedbackConnection, { provider: 'github'; transport: 'gh' }>;
const START_ENV = { ...process.env };
const START_CWD = process.cwd();
const PER_CALL = 2 * 1024 * 1024;
const TOTAL = 16 * 1024 * 1024;
const DEADLINE_MS = 30_000;
let occupied = false;
let poisoned = false;

const error = (code: string, message: string): ConcordError => new ConcordError(code, message);
const within = (path: string, root: string): boolean => path === root || (!relative(root, path).startsWith(`..${sep}`) && relative(root, path) !== '..' && !isAbsolute(relative(root, path)));
const packagePath = (path: string): boolean => path.split(sep).includes('node_modules');

function trustedExecutable(root: string): { readonly executable: string; readonly path: string } {
  const repository = realpathSync(root);
  const candidates = (START_ENV.PATH ?? '').split(delimiter).filter((part) => part.length > 0 && isAbsolute(part) && !packagePath(part) && !within(part, repository));
  const trusted: string[] = [];
  for (const entry of candidates) {
    let directory: string;
    try { directory = realpathSync(entry); } catch { continue; }
    if (packagePath(directory) || within(directory, repository)) continue;
    if (!trusted.includes(directory)) trusted.push(directory);
  }
  for (const directory of trusted) {
    const candidate = join(directory, 'gh');
    try {
      const executable = realpathSync(candidate);
      if (packagePath(executable) || within(executable, repository)) continue;
      accessSync(executable, constants.X_OK);
      return { executable, path: trusted.join(delimiter) };
    } catch { /* try next trusted PATH entry */ }
  }
  throw error('GhUnavailable', 'A trusted GitHub CLI executable is unavailable');
}

function ghEnvironment(path: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: path, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', GH_NO_EXTENSION_UPDATE_NOTIFIER: '1', NO_COLOR: '1', CLICOLOR: '0', GH_TELEMETRY: 'false' };
  for (const name of ['HOME', 'GH_CONFIG_DIR', 'XDG_CONFIG_HOME'] as const) {
    const value = START_ENV[name];
    if (value !== undefined && value.length > 0) env[name] = resolve(START_CWD, value);
  }
  for (const name of ['XDG_RUNTIME_DIR', 'SSH_AUTH_SOCK', 'SSL_CERT_FILE', 'SSL_CERT_DIR'] as const) {
    const value = START_ENV[name];
    if (value !== undefined && value.length > 0) env[name] = resolve(START_CWD, value);
  }
  const dbus = START_ENV.DBUS_SESSION_BUS_ADDRESS;
  if (dbus !== undefined && (!dbus.startsWith('unix:path=') || isAbsolute(dbus.slice('unix:path='.length)))) env.DBUS_SESSION_BUS_ADDRESS = dbus;
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy'] as const) {
    const value = START_ENV[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

const HeaderSchema = Schema.Struct({ status: Schema.Int, headers: Schema.Record(Schema.String, Schema.String), body: Schema.Unknown });
const RepositorySchema = Schema.Struct({ id: Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)), full_name: Schema.String.check(Schema.isMinLength(3), Schema.isMaxLength(1025)) });
function repositoryIdentity(body: unknown, owner: string, repo: string): number {
  let repository: typeof RepositorySchema.Type;
  try { repository = Schema.decodeUnknownSync(RepositorySchema, { onExcessProperty: 'ignore' })(body); }
  catch { throw error('GhProtocolInvalid', 'GitHub CLI returned an invalid repository identity'); }
  if (repository.full_name.toLowerCase() !== `${owner}/${repo}`.toLowerCase()) throw error('GhTargetInaccessible', 'GitHub CLI returned a different repository');
  return repository.id;
}
function parseResponse(stdout: string): typeof HeaderSchema.Type {
  const separator = /\r?\n\r?\n/u.exec(stdout);
  if (separator === null || separator.index > 64 * 1024) throw error('GhProtocolInvalid', 'GitHub CLI returned an invalid HTTP response');
  const head = stdout.slice(0, separator.index).split(/\r?\n/u);
  const status = /^HTTP\/(?:1\.[01]|2(?:\.0)?|3(?:\.0)?) ([1-5][0-9]{2})(?:\s|$)/u.exec(head.shift() ?? '');
  if (status === null) throw error('GhProtocolInvalid', 'GitHub CLI returned an invalid HTTP status');
  const headers: Record<string, string> = {};
  for (const line of head) {
    const match = /^([A-Za-z0-9-]+):\s*(.*)$/u.exec(line);
    if (match === null) throw error('GhProtocolInvalid', 'GitHub CLI returned invalid response headers');
    headers[match[1]!] = match[2]!;
  }
  const bodyText = stdout.slice(separator.index + separator[0].length);
  let body: unknown;
  try { body = JSON.parse(bodyText) as unknown; }
  catch { throw error('GhProtocolInvalid', 'GitHub CLI returned invalid JSON'); }
  try { return Schema.decodeUnknownSync(HeaderSchema)({ status: Number(status[1]), headers, body }); }
  catch { throw error('GhProtocolInvalid', 'GitHub CLI returned an invalid HTTP response'); }
}

function classifyExit(stderr: string): ConcordError {
  if (/authentication required|not logged in|authenticate|gh auth login|bad credentials/iu.test(stderr)) return error('GhNotAuthenticated', 'GitHub CLI is not authenticated');
  if (/not found|could not resolve|resource not accessible|forbidden/iu.test(stderr)) return error('GhTargetInaccessible', 'The configured GitHub repository is inaccessible');
  return error('GhRequestFailed', 'GitHub CLI could not read the configured repository');
}

function ghTraversal<A, E>(root: string, use: (run: (args: readonly string[], stdin?: string, beforeSpawn?: () => void) => Effect.Effect<{ readonly stdout: string; readonly stderr: string; readonly status: number }, ConcordError>) => Effect.Effect<A, E>, budgets: { readonly total: number; readonly deadline: number; readonly issue?: boolean } = { total: TOTAL, deadline: DEADLINE_MS }): Effect.Effect<A, E | ConcordError> {
  return Effect.scoped(Effect.gen(function* () {
    if (process.platform === 'win32') return yield* Effect.fail(error('GhPlatformUnsupported', 'GitHub CLI feedback requires POSIX process groups'));
    yield* Effect.acquireRelease(Effect.try({
      try: () => {
        if (poisoned) throw error('GhCleanupUnconfirmed', 'A previous GitHub CLI process could not be confirmed stopped');
        if (occupied) throw error('GhBusy', 'Another GitHub CLI feedback read is active');
        occupied = true;
      },
      catch: (cause) => cause instanceof ConcordError ? cause : error('GhUnavailable', 'Could not acquire the GitHub CLI read slot'),
    }), () => Effect.sync(() => { occupied = false; }));
    const processService = makeOwnedProcessService({ graceMs: 500 });
    const directory = yield* Effect.acquireRelease(
      Effect.try({ try: () => mkdtempSync(join(tmpdir(), 'concord-gh-')), catch: () => error('GhUnavailable', 'Could not create an isolated GitHub CLI directory') }),
      (path) => Effect.gen(function* () {
        yield* processService.awaitIdle;
        const results = yield* processService.cleanupResults;
        const count = yield* processService.activeCount;
        if (count !== 0 || results.some((result) => !hasConfirmedOwnedGroupCleanup(result))) poisoned = true;
        yield* Effect.sync(() => { try { rmSync(path, { recursive: true, force: true }); } catch { poisoned = true; } });
      }),
    );
    const trusted = yield* Effect.try({ try: () => trustedExecutable(root), catch: (cause) => cause instanceof ConcordError ? cause : error('GhUnavailable', 'Could not resolve a trusted GitHub CLI executable') });
    const env = ghEnvironment(trusted.path);
    let spent = 0;
    const deadline = Date.now() + budgets.deadline;
    const run = (args: readonly string[], stdin?: string, beforeSpawn?: () => void): Effect.Effect<{ readonly stdout: string; readonly stderr: string; readonly status: number }, ConcordError> => Effect.gen(function* () {
      const remaining = Math.min(PER_CALL, budgets.total - spent);
      const time = deadline - Date.now();
      if (remaining < 1) return yield* Effect.fail(error(budgets.issue ? 'IssueRemoteBudgetExceeded' : 'GhLimitExceeded', 'GitHub CLI feedback exceeded its total output budget'));
      if (time < 1) return yield* Effect.fail(error('GhTimeout', 'GitHub CLI feedback read timed out'));
      if (beforeSpawn !== undefined) yield* Effect.sync(beforeSpawn);
      const result = yield* Effect.scoped(processService.run([trusted.executable, ...args], { cwd: directory, env, timeoutMs: time, outputLimitBytes: remaining, ...(stdin === undefined ? {} : { stdin }) })).pipe(
        Effect.mapError(() => error('GhUnavailable', 'Could not start GitHub CLI')),
      );
      spent += result.outputBytes;
      if (!hasConfirmedOwnedGroupCleanup(result)) { poisoned = true; return yield* Effect.fail(error('GhCleanupUnconfirmed', 'GitHub CLI process cleanup could not be confirmed')); }
      if (result.outputLimitExceeded || spent > budgets.total) return yield* Effect.fail(error(budgets.issue ? 'IssueRemoteBudgetExceeded' : 'GhLimitExceeded', 'GitHub CLI feedback exceeded its output budget'));
      if (result.timedOut || Date.now() > deadline) return yield* Effect.fail(error('GhTimeout', 'GitHub CLI feedback read timed out'));
      if (result.cancelled) return yield* Effect.fail(error('GhCancelled', 'GitHub CLI feedback read was cancelled'));
      if (result.error !== undefined) return yield* Effect.fail(error('GhUnavailable', 'Could not run GitHub CLI'));
      if (result.exitCode !== 0 && args[0] !== 'api') return yield* Effect.fail(error('GhProtocolInvalid', 'GitHub CLI does not support the required API command'));
      return { stdout: result.stdout, stderr: result.stderr, status: result.exitCode ?? -1 };
    });
    const capabilities = Effect.gen(function*() {
      const version = yield* run(['--version']);
      const match = /^gh version (\d+)\.(\d+)\.(\d+)/mu.exec(version.stdout);
      if (match === null || Number(match[1]) < 2 || (Number(match[1]) === 2 && Number(match[2]) < 98)) return yield* Effect.fail(error('GhProtocolInvalid', 'GitHub CLI version 2.98.0 or newer is required'));
      const help = yield* run(['api', '--help']);
      if (help.status !== 0 || !['--hostname', '--method', '--include', ...(budgets.issue ? ['--input'] : [])].every(flag => help.stdout.includes(flag))) return yield* Effect.fail(error('GhProtocolInvalid', 'GitHub CLI lacks required API flags'));
    });
    if (!budgets.issue) { yield* capabilities; return yield* use(run); }
    let checked = false;
    return yield* use((args, stdin, beforeSpawn) => Effect.gen(function*() {
      if (!checked) { yield* capabilities; checked = true; }
      return yield* run(args, stdin, beforeSpawn);
    }));
  })).pipe(Effect.flatMap((value) => poisoned ? Effect.fail(error('GhCleanupUnconfirmed', 'GitHub CLI cleanup could not be confirmed')) : Effect.succeed(value)));
}

function transportFor(run: (args: readonly string[]) => Effect.Effect<{ readonly stdout: string; readonly stderr: string; readonly status: number }, ConcordError>): FeedbackTransport {
  return (request) => Effect.gen(function* () {
    let parsed: URL;
    try { parsed = new URL(request.url); } catch { return yield* Effect.fail(error('GhProtocolInvalid', 'Invalid GitHub API request')); }
    if (request.method !== 'GET' || parsed.origin !== 'https://api.github.com' || !parsed.pathname.startsWith('/repos/') || request.body !== undefined) return yield* Effect.fail(error('GhProtocolInvalid', 'Unsupported GitHub CLI request'));
    const result = yield* run(['api', '--hostname', 'github.com', '--method', 'GET', '--include', `${parsed.pathname.slice(1)}${parsed.search}`]);
    let response: typeof HeaderSchema.Type;
    try { response = parseResponse(result.stdout); }
    catch (cause) { return yield* Effect.fail(result.status !== 0 ? classifyExit(result.stderr) : cause instanceof ConcordError ? cause : error('GhProtocolInvalid', 'GitHub CLI returned an invalid HTTP response')); }
    if (result.status !== 0 && response.status >= 200 && response.status < 300) return yield* Effect.fail(classifyExit(result.stderr));
    if (response.status === 200 && parsed.pathname.split('/').filter(Boolean).length === 3) {
      const parts = parsed.pathname.split('/');
      yield* Effect.try({ try: () => repositoryIdentity(response.body, decodeURIComponent(parts[2]!), decodeURIComponent(parts[3]!)), catch: (cause) => cause instanceof ConcordError ? cause : error('GhProtocolInvalid', 'GitHub CLI returned an invalid repository identity') });
    }
    return response;
  });
}

export function fetchGhFeedback(root: string, connection: GhConnection, url?: string): Effect.Effect<FeedbackFetch, ConcordError> {
  return ghTraversal(root, (run) => fetchFeedback(connection, { transport: transportFor(run), ...(url === undefined ? {} : { url }) })).pipe(
    Effect.timeoutOrElse({ duration: '30 seconds', orElse: () => Effect.fail(error('GhTimeout', 'GitHub CLI feedback read timed out')) }),
  );
}

export function checkGhConnection(root: string, connection: GhConnection): Effect.Effect<{ readonly connectionId: string; readonly provider: 'github'; readonly transport: 'gh'; readonly target: string; readonly checkedAt: string }, ConcordError> {
  return ghTraversal(root, (run) => Effect.gen(function* () {
    const endpoint = `https://api.github.com/repos/${encodeURIComponent(connection.owner)}/${encodeURIComponent(connection.repo)}`;
    const response = yield* transportFor(run)({ url: endpoint, method: 'GET', headers: {} });
    if (response.status === 401) return yield* Effect.fail(error('GhNotAuthenticated', 'GitHub CLI is not authenticated'));
    if (response.status === 403 || response.status === 404) return yield* Effect.fail(error('GhTargetInaccessible', 'The configured GitHub repository is inaccessible'));
    if (response.status !== 200) return yield* Effect.fail(error('GhRequestFailed', 'GitHub CLI could not read the configured repository'));
    const repositoryId = yield* Effect.try({ try: () => repositoryIdentity(response.body, connection.owner, connection.repo), catch: (cause) => cause instanceof ConcordError ? cause : error('GhProtocolInvalid', 'GitHub CLI returned an invalid repository identity') });
    if (connection.repositoryId !== undefined && connection.repositoryId !== String(repositoryId)) return yield* Effect.fail(error('ConnectionIdentityMismatch', 'The GitHub repository identity no longer matches the bound connection'));
    return { connectionId: connection.id, provider: 'github' as const, transport: 'gh' as const, target: `${connection.owner}/${connection.repo}`, checkedAt: DateTime.formatIso(yield* DateTime.now) };
  }));
}

/** Issue-only traversal: writes are available solely to execute callers. */
export function withGhIssueTransport<A, E>(root: string, connection: GhConnection, execute: boolean, use: (request: (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, payload?: unknown) => Effect.Effect<{ readonly status: number; readonly headers: Readonly<Record<string, string>>; readonly body: unknown }, ConcordError>) => Effect.Effect<A, E>): Effect.Effect<A, E | ConcordError> {
  return ghTraversal(root, run => {
    const prefix = `repos/${encodeURIComponent(connection.owner)}/${encodeURIComponent(connection.repo)}`;
    const request = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, payload?: unknown) => Effect.gen(function*() {
      if (method === 'GET' && ((path !== prefix && !path.startsWith(`${prefix}/`)) || payload !== undefined)) return yield* Effect.fail(error('GhProtocolInvalid', 'Unsupported Issue read request'));
      if (method !== 'GET' && (!execute || !allowedIssueWrite(method, path, prefix, payload))) return yield* Effect.fail(error('GhProtocolInvalid', 'Unsupported Issue write request'));
      let sent = false;
      const result = yield* run(['api', '--hostname', 'github.com', '--method', method, '--include', ...(method === 'GET' ? [] : ['--input', '-']), path], method === 'GET' ? undefined : JSON.stringify(payload ?? {}), () => { sent = true; }).pipe(
        Effect.mapError(cause => method === 'GET' || !sent ? cause : error('IssueMutationUncertain', 'Issue write result is uncertain')),
      );
      let response: typeof HeaderSchema.Type;
      try { response = parseResponse(result.stdout); }
      catch (cause) {
        // HTTP 204 has an empty body (label deletion).
        if (method !== 'GET' && /^HTTP\/(?:1\.[01]|2(?:\.0)?|3(?:\.0)?) 204(?:\s|$)/u.test(result.stdout)) return { status: 204, headers: {}, body: null };
        const status = /^HTTP\/(?:1\.[01]|2(?:\.0)?|3(?:\.0)?) ([45][0-9]{2})(?:\s|$)/u.exec(result.stdout)?.[1];
        if (method !== 'GET' && status !== undefined) return yield* Effect.fail(new ConcordError('IssueRemoteRejected', 'GitHub rejected the Issue write', { status: Number(status) }));
        return yield* Effect.fail(method !== 'GET' ? error('IssueMutationUncertain', 'Issue write response could not be parsed') : result.status !== 0 ? classifyExit(result.stderr) : cause instanceof ConcordError ? cause : error('GhProtocolInvalid', 'Invalid Issue response'));
      }
      if (response.status < 200 || response.status >= 300) return yield* Effect.fail(method !== 'GET' ? new ConcordError('IssueRemoteRejected', 'GitHub rejected the Issue write', { status: response.status }) : error('GhTargetInaccessible', 'GitHub Issue target is inaccessible'));
      if (result.status !== 0) return yield* Effect.fail(method !== 'GET' ? error('IssueMutationUncertain', 'Issue write process did not complete successfully') : classifyExit(result.stderr));
      return response;
    });
    return use(request);
  }, { total: 64 * 1024 * 1024, deadline: 120_000, issue: true });
}
function allowedIssueWrite(method: string, path: string, prefix: string, body: unknown): boolean {
  if (!path.startsWith(`${prefix}/issues`) || typeof body !== 'object' || body === null) return false;
  const suffix = path.slice(prefix.length);
  const keys = Object.keys(body).sort().join(',');
  if (method === 'POST' && suffix === '/issues') return keys === 'body,title';
  if (method === 'PATCH' && /^\/issues\/[1-9][0-9]*$/u.test(suffix)) {
    const record = body as Record<string, unknown>;
    return keys === 'body' || keys === 'state' && (record.state === 'open' || record.state === 'closed') || keys === 'state,state_reason' && record.state === 'closed' && (record.state_reason === 'completed' || record.state_reason === 'not_planned');
  }
  return method === 'POST' && /^\/issues\/[1-9][0-9]*\/labels$/u.test(suffix) && keys === 'labels' || method === 'POST' && /^\/issues\/[1-9][0-9]*\/comments$/u.test(suffix) && keys === 'body' || method === 'DELETE' && /^\/issues\/[1-9][0-9]*\/labels\/[^/]+$/u.test(suffix) && keys === '';
}
