// @concord-file feedback-provider-adapters
// @concord-implements docs/feature/feedback/use-case/triage-feedback.md
import { DateTime, Effect, Predicate, Schema } from 'effect';
import { RemoteFeedbackSchema, type FeedbackConnection, type RemoteFeedback } from './feedback-schema.js';
import { ConcordError, canonical } from './shared.js';

const GITHUB_API = 'https://api.github.com';
const LINEAR_API = 'https://api.linear.app';
const LINEAR_GRAPHQL = `${LINEAR_API}/graphql`;
const PAGE_SIZE = 100;
const MAX_PAGES = 100;
const MAX_ITEMS = 10_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const REQUEST_TIMEOUT = '15 seconds';
const FETCH_TIMEOUT = '30 seconds';

const NonEmptyString = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(16_384), Schema.isPattern(/^[^\0]*$/u));
const UrlString = NonEmptyString.check(Schema.isMaxLength(8 * 1024));
const ShortString = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512));
const BodyString = Schema.String.check(Schema.isMaxLength(256 * 1024), Schema.isPattern(/^[^\0]*$/u));
const PositiveSafeInteger = Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER));
const Uuid = Schema.String.check(Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u));
const HttpResponseSchema = Schema.Struct({
  status: Schema.Int,
  headers: Schema.Record(Schema.String, Schema.String),
  body: Schema.Unknown,
});

const GitHubRepositorySchema = Schema.Struct({ id: PositiveSafeInteger });
const GitHubIssueSchema = Schema.Struct({
  id: PositiveSafeInteger,
  number: PositiveSafeInteger,
  html_url: UrlString,
  title: NonEmptyString,
  body: Schema.NullOr(BodyString),
  state: ShortString,
  updated_at: NonEmptyString,
  pull_request: Schema.optional(Schema.Unknown),
});

const GraphQlErrorSchema = Schema.Struct({
  message: Schema.optional(Schema.String),
  extensions: Schema.optional(Schema.Struct({ code: Schema.optional(Schema.String) })),
});
const GraphQlEnvelopeSchema = Schema.Struct({
  data: Schema.optional(Schema.NullOr(Schema.Unknown)),
  errors: Schema.optional(Schema.Array(GraphQlErrorSchema)),
});
const PageInfoSchema = Schema.Struct({ hasNextPage: Schema.Boolean, endCursor: Schema.NullOr(Schema.String) });
const LinearTeamSchema = Schema.Struct({ id: Uuid, key: ShortString, name: ShortString });
const LinearTeamsDataSchema = Schema.Struct({
  viewer: Schema.Struct({ organization: Schema.Struct({ id: Uuid }) }),
  teams: Schema.Struct({ nodes: Schema.Array(LinearTeamSchema), pageInfo: PageInfoSchema }),
});
const LinearIssueSchema = Schema.Struct({
  id: Uuid,
  identifier: ShortString,
  url: UrlString,
  title: NonEmptyString,
  description: Schema.NullOr(BodyString),
  updatedAt: NonEmptyString,
  state: Schema.Struct({ type: ShortString, name: ShortString }),
  team: Schema.Struct({ id: Uuid }),
});
const LinearIssuesDataSchema = Schema.Struct({
  issues: Schema.Struct({ nodes: Schema.Array(LinearIssueSchema), pageInfo: PageInfoSchema }),
});
const LinearSingleIssueDataSchema = Schema.Struct({ issue: LinearIssueSchema });

type TransportRequest = {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
};

type TransportResponse = {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
};

export type FeedbackTransport = (request: TransportRequest) => Effect.Effect<TransportResponse, ConcordError>;

export interface FeedbackFetch {
  readonly connection: FeedbackConnection;
  readonly items: readonly RemoteFeedback[];
  readonly fetchStartedAt: string;
  readonly fetchedAt: string;
}

export interface FeedbackFetchOptions {
  readonly url?: string;
  readonly transport?: FeedbackTransport;
  /** Test seam only. Production callers leave this unset and use credentialEnv. */
  readonly credential?: string;
}

type FetchBudget = { pages: number; items: number; bytes: number };

function providerError(code: string, message: string): ConcordError {
  return new ConcordError(code, message);
}

function decodeVendor<A>(schema: Schema.ConstraintDecoder<A, never>, value: unknown, source: string): A {
  try {
    return Schema.decodeUnknownSync(schema, { onExcessProperty: 'ignore', errors: 'all' })(value);
  } catch {
    throw providerError('ProviderResponseInvalid', `${source} returned an invalid response`);
  }
}

function normalizeDate(value: string, source: string): string {
  try {
    return Schema.decodeUnknownSync(Schema.DateFromString)(value).toISOString();
  } catch {
    throw providerError('ProviderResponseInvalid', `${source} returned an invalid updated timestamp`);
  }
}

function normalizeText(value: string, maximum: number, source: string, allowEmpty = false): string {
  const normalized = value.replace(/\r\n?/gu, '\n').trim();
  if ((!allowEmpty && normalized.length === 0) || normalized.length > maximum) {
    throw providerError('ProviderResponseInvalid', `${source} returned an invalid text field`);
  }
  return normalized;
}

function normalizeBody(value: string): string {
  return value.replace(/\r\n?/gu, '\n');
}

function normalizedRemoteUrl(value: string, provider: 'github' | 'linear'): string {
  let parsed: URL;
  try {
    parsed = Schema.decodeUnknownSync(Schema.URLFromString)(value);
  } catch {
    throw providerError('ProviderResponseInvalid', `${provider} returned an invalid item URL`);
  }
  const allowedHost = provider === 'github' ? 'github.com' : 'linear.app';
  if (parsed.protocol !== 'https:' || parsed.hostname !== allowedHost || parsed.port !== '' || parsed.username !== '' || parsed.password !== '') {
    throw providerError('ProviderResponseInvalid', `${provider} returned an item URL outside its supported host`);
  }
  parsed.hash = '';
  return parsed.toString();
}

function responseBytes(body: unknown): number {
  try {
    const encoded = Predicate.isString(body) ? body : JSON.stringify(body);
    if (encoded === undefined) throw new Error('not serializable');
    return Buffer.byteLength(encoded);
  } catch {
    throw providerError('ProviderResponseInvalid', 'Provider returned a body that cannot be decoded');
  }
}

function accountResponse(budget: FetchBudget, body: unknown): void {
  const bytes = responseBytes(body);
  if (bytes > MAX_RESPONSE_BYTES) throw providerError('ProviderLimitExceeded', 'A provider response exceeded the per-page byte limit');
  budget.bytes += bytes;
  if (budget.bytes > MAX_TOTAL_BYTES) throw providerError('ProviderLimitExceeded', 'The provider traversal exceeded its byte limit');
}

function accountPage(budget: FetchBudget): void {
  budget.pages += 1;
  if (budget.pages > MAX_PAGES) throw providerError('ProviderLimitExceeded', 'The provider traversal exceeded its page limit');
}

function accountItems(budget: FetchBudget, count: number): void {
  budget.items += count;
  if (budget.items > MAX_ITEMS) throw providerError('ProviderLimitExceeded', 'The provider traversal exceeded its item limit');
}

function headerValue(headers: Readonly<Record<string, string>>, name: string): string | undefined {
  const expected = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) if (key.toLowerCase() === expected) return value;
  return undefined;
}

function statusFailure(status: number, headers: Readonly<Record<string, string>>, github = false): ConcordError {
  if (status === 429 || (github && (headerValue(headers, 'retry-after') !== undefined || headerValue(headers, 'x-ratelimit-remaining') === '0'))) {
    return providerError('RateLimited', 'The feedback provider rate limited the request');
  }
  if (status === 401) return providerError('AuthenticationFailed', 'The feedback provider rejected the configured credential');
  if (status === 404) return providerError('RemoteNotFound', 'The requested provider resource was not found');
  return providerError('ProviderRequestFailed', `The feedback provider returned HTTP ${status}`);
}

const defaultTransport: FeedbackTransport = Effect.fn('feedback.defaultTransport')(function*(request): Effect.fn.Return<TransportResponse, ConcordError> {
  const response = yield* Effect.tryPromise({
    try: async signal => {
      const result = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        redirect: 'error',
        signal,
      });
      if (result.body === null) return { result, text: '' };
      const reader = result.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw providerError('ProviderLimitExceeded', 'A provider response exceeded the per-page byte limit');
        }
        chunks.push(chunk.value);
      }
      return { result, text: Buffer.concat(chunks).toString('utf8') };
    },
    catch: cause => cause instanceof ConcordError ? cause : providerError('ProviderRequestFailed', 'The feedback provider request failed'),
  });
  let body: unknown = null;
  if (response.text.length > 0) {
    try {
      body = JSON.parse(response.text) as unknown;
    } catch {
      body = response.text;
    }
  }
  return {
    status: response.result.status,
    headers: Object.fromEntries(response.result.headers.entries()),
    body,
  };
}, Effect.timeoutOrElse({
  duration: REQUEST_TIMEOUT,
  orElse: () => Effect.fail(providerError('ProviderTimeout', 'The feedback provider request timed out')),
}));

const send = Effect.fn('feedback.send')(function*(transport: FeedbackTransport, request: TransportRequest, budget: FetchBudget): Effect.fn.Return<TransportResponse, ConcordError> {
  const raw = yield* transport(request);
  const response = decodeVendor(HttpResponseSchema, raw, 'feedback transport');
  accountResponse(budget, response.body);
  if ((response.status < 200 || response.status >= 300) && !(request.url === LINEAR_GRAPHQL && response.status === 400)) {
    return yield* Effect.fail(statusFailure(response.status, response.headers, request.url.startsWith(`${GITHUB_API}/`)));
  }
  return response;
});

function credentialFor(connection: FeedbackConnection, override?: string): string {
  const credential = override ?? process.env[connection.credentialEnv];
  if (credential === undefined || credential.length === 0) {
    throw providerError('CredentialMissing', `Credential environment variable ${connection.credentialEnv} is not set`);
  }
  return credential;
}

function githubHeaders(credential: string): Readonly<Record<string, string>> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${credential}`,
    'User-Agent': 'concord-sdlc',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function linearHeaders(credential: string): Readonly<Record<string, string>> {
  return { Accept: 'application/json', Authorization: credential, 'Content-Type': 'application/json' };
}

function pathSegment(value: string): string {
  return encodeURIComponent(value);
}

function parsePositiveInteger(value: string, source: string): number {
  if (!/^[1-9][0-9]*$/u.test(value)) throw providerError('UnsupportedFeedbackUrl', `${source} does not identify a supported feedback item`);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw providerError('UnsupportedFeedbackUrl', `${source} contains an out-of-range item number`);
  return number;
}

type GitHubImport = { readonly owner: string; readonly repo: string; readonly number: number };

function decodedPathParts(parsed: URL, provider: 'GitHub' | 'Linear'): readonly string[] {
  try {
    return parsed.pathname.split('/').filter(Boolean).map(part => decodeURIComponent(part));
  } catch {
    throw providerError('UnsupportedFeedbackUrl', `${provider} URL contains malformed path encoding`);
  }
}

function parseGitHubImport(value: string): GitHubImport {
  if (value.length > 8 * 1024 || value.trim() !== value) throw providerError('UnsupportedFeedbackUrl', 'GitHub import requires a bounded canonical issue URL');
  let parsed: URL;
  try {
    parsed = Schema.decodeUnknownSync(Schema.URLFromString)(value);
  } catch {
    throw providerError('UnsupportedFeedbackUrl', 'GitHub import requires a supported HTTPS issue URL');
  }
  if (parsed.protocol !== 'https:' || parsed.port !== '' || parsed.username !== '' || parsed.password !== '') {
    throw providerError('UnsupportedFeedbackUrl', 'GitHub import requires a supported HTTPS issue URL');
  }
  const parts = decodedPathParts(parsed, 'GitHub');
  if (parsed.hostname === 'github.com' && parts.length >= 4) {
    if (parts[2] === 'pull') throw providerError('PullRequestUnsupported', 'GitHub pull requests cannot be imported as feedback issues');
    if (parts[2] === 'issues' && parts.length === 4) return { owner: parts[0]!, repo: parts[1]!, number: parsePositiveInteger(parts[3]!, 'GitHub URL') };
  }
  if (parsed.hostname === 'api.github.com' && parts.length === 5 && parts[0] === 'repos' && parts[3] === 'issues') {
    return { owner: parts[1]!, repo: parts[2]!, number: parsePositiveInteger(parts[4]!, 'GitHub URL') };
  }
  throw providerError('UnsupportedFeedbackUrl', 'GitHub import requires a github.com issue URL');
}

function assertGitHubImportScope(connection: Extract<FeedbackConnection, { provider: 'github' }>, item: GitHubImport): void {
  if (connection.owner.toLocaleLowerCase('en-US') !== item.owner.toLocaleLowerCase('en-US') || connection.repo.toLocaleLowerCase('en-US') !== item.repo.toLocaleLowerCase('en-US')) {
    throw providerError('FeedbackScopeMismatch', 'The GitHub issue URL is outside the configured repository');
  }
}

function githubRemote(issue: typeof GitHubIssueSchema.Type): RemoteFeedback {
  return decodeVendor(RemoteFeedbackSchema, {
    provider: 'github',
    instance: GITHUB_API,
    id: String(issue.id),
    url: normalizedRemoteUrl(issue.html_url, 'github'),
    title: normalizeText(issue.title, 4 * 1024, 'GitHub'),
    body: normalizeBody(issue.body ?? ''),
    state: normalizeText(issue.state, 128, 'GitHub'),
    updatedAt: normalizeDate(issue.updated_at, 'GitHub'),
  }, 'GitHub issue');
}

function sameRemote(left: RemoteFeedback, right: RemoteFeedback): boolean {
  return canonical(left) === canonical(right);
}

function keepLatest(target: Map<string, RemoteFeedback>, next: RemoteFeedback): void {
  const current = target.get(next.id);
  if (current === undefined) {
    target.set(next.id, next);
    return;
  }
  if (current.updatedAt < next.updatedAt) target.set(next.id, next);
  else if (current.updatedAt === next.updatedAt && !sameRemote(current, next)) {
    throw providerError('RemoteIdentityConflict', `Provider item ${next.id} repeated with conflicting content at the same version`);
  }
}

const fetchGitHub = Effect.fn('feedback.fetchGitHub')(function*(
  connection: Extract<FeedbackConnection, { provider: 'github' }>,
  options: FeedbackFetchOptions,
  credential: string,
  transport: FeedbackTransport,
  budget: FetchBudget,
): Effect.fn.Return<{ readonly connection: FeedbackConnection; readonly items: readonly RemoteFeedback[] }, ConcordError> {
  const headers = githubHeaders(credential);
  const selected = options.url === undefined ? undefined : parseGitHubImport(options.url);
  if (selected !== undefined) assertGitHubImportScope(connection, selected);
  const repoUrl = `${GITHUB_API}/repos/${pathSegment(connection.owner)}/${pathSegment(connection.repo)}`;
  const repoResponse = yield* send(transport, { url: repoUrl, method: 'GET', headers }, budget);
  const repository = decodeVendor(GitHubRepositorySchema, repoResponse.body, 'GitHub repository');
  const repositoryId = String(repository.id);
  if (connection.repositoryId !== undefined && connection.repositoryId !== repositoryId) {
    return yield* Effect.fail(providerError('ConnectionIdentityMismatch', 'The GitHub repository identity no longer matches the bound connection'));
  }
  const bound: FeedbackConnection = { ...connection, repositoryId };
  const items = new Map<string, RemoteFeedback>();
  if (selected !== undefined) {
    const response = yield* send(transport, { url: `${repoUrl}/issues/${selected.number}`, method: 'GET', headers }, budget);
    const issue = decodeVendor(GitHubIssueSchema, response.body, 'GitHub issue');
    if (issue.pull_request !== undefined) return yield* Effect.fail(providerError('PullRequestUnsupported', 'GitHub pull requests cannot be imported as feedback issues'));
    const returned = parseGitHubImport(issue.html_url);
    assertGitHubImportScope(connection, returned);
    if (issue.number !== selected.number || returned.number !== selected.number) {
      return yield* Effect.fail(providerError('FeedbackScopeMismatch', 'GitHub returned a different issue than the requested URL'));
    }
    accountItems(budget, 1);
    keepLatest(items, githubRemote(issue));
  } else {
    for (let page = 1;; page += 1) {
      accountPage(budget);
      const response = yield* send(transport, { url: `${repoUrl}/issues?state=all&per_page=${PAGE_SIZE}&page=${page}`, method: 'GET', headers }, budget);
      const pageItems = decodeVendor(Schema.Array(GitHubIssueSchema), response.body, 'GitHub issues');
      accountItems(budget, pageItems.length);
      for (const issue of pageItems) if (issue.pull_request === undefined) keepLatest(items, githubRemote(issue));
      if (pageItems.length < PAGE_SIZE) break;
    }
  }
  return { connection: bound, items: [...items.values()].sort((left, right) => left.id.localeCompare(right.id)) };
});

function graphQlRateLimited(errors: readonly typeof GraphQlErrorSchema.Type[]): boolean {
  return errors.some(error => {
    const code = error.extensions?.code?.toUpperCase().replace(/[^A-Z]/gu, '');
    return code === 'RATELIMITED' || code === 'TOOMANYREQUESTS';
  });
}

const graphQl = Effect.fn('feedback.graphQl')(function*<A>(
  transport: FeedbackTransport,
  credential: string,
  query: string,
  variables: Readonly<Record<string, unknown>>,
  dataSchema: Schema.ConstraintDecoder<A, never>,
  budget: FetchBudget,
): Effect.fn.Return<A, ConcordError> {
  const response = yield* send(transport, {
    url: LINEAR_GRAPHQL,
    method: 'POST',
    headers: linearHeaders(credential),
    body: JSON.stringify({ query, variables }),
  }, budget);
  const envelope = decodeVendor(GraphQlEnvelopeSchema, response.body, 'Linear GraphQL');
  if (envelope.errors !== undefined && envelope.errors.length > 0) {
    if (graphQlRateLimited(envelope.errors)) return yield* Effect.fail(providerError('RateLimited', 'Linear rate limited the request'));
    return yield* Effect.fail(providerError('ProviderGraphQlFailed', 'Linear returned GraphQL errors'));
  }
  if (response.status !== 200) return yield* Effect.fail(statusFailure(response.status, response.headers));
  if (envelope.data === undefined || envelope.data === null) return yield* Effect.fail(providerError('ProviderResponseInvalid', 'Linear returned no GraphQL data'));
  return decodeVendor(dataSchema, envelope.data, 'Linear GraphQL data');
});

const LINEAR_TEAMS_QUERY = `query ConcordFeedbackTeams($first: Int!, $after: String) {
  viewer { organization { id } }
  teams(first: $first, after: $after, includeArchived: true) { nodes { id key name } pageInfo { hasNextPage endCursor } }
}`;
const LINEAR_ISSUES_QUERY = `query ConcordFeedbackIssues($first: Int!, $after: String, $teamId: ID!) {
  issues(first: $first, after: $after, includeArchived: true, filter: { team: { id: { eq: $teamId } } }) {
    nodes { id identifier url title description updatedAt state { type name } team { id } }
    pageInfo { hasNextPage endCursor }
  }
}`;
const LINEAR_ISSUE_QUERY = `query ConcordFeedbackIssue($issueId: String!) {
  issue(id: $issueId) { id identifier url title description updatedAt state { type name } team { id } }
}`;

type LinearImport = { readonly workspace: string; readonly identifier: string };

function parseLinearImport(value: string): LinearImport {
  if (value.length > 8 * 1024 || value.trim() !== value) throw providerError('UnsupportedFeedbackUrl', 'Linear import requires a bounded canonical issue URL');
  let parsed: URL;
  try {
    parsed = Schema.decodeUnknownSync(Schema.URLFromString)(value);
  } catch {
    throw providerError('UnsupportedFeedbackUrl', 'Linear import requires a supported HTTPS issue URL');
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'linear.app' || parsed.port !== '' || parsed.username !== '' || parsed.password !== '') {
    throw providerError('UnsupportedFeedbackUrl', 'Linear import requires a linear.app HTTPS issue URL');
  }
  const parts = decodedPathParts(parsed, 'Linear');
  if (parts.length < 3 || parts[1] !== 'issue') throw providerError('UnsupportedFeedbackUrl', 'Linear import requires a linear.app issue URL');
  const identifier = normalizeText(parts[2]!, 128, 'Linear URL');
  if (!/^[A-Za-z][A-Za-z0-9]*-[1-9][0-9]*$/u.test(identifier)) throw providerError('UnsupportedFeedbackUrl', 'Linear URL contains an invalid issue identifier');
  const workspace = normalizeText(parts[0]!, 512, 'Linear URL');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(workspace)) throw providerError('UnsupportedFeedbackUrl', 'Linear URL contains an invalid workspace slug');
  return { workspace, identifier };
}

function linearRemote(issue: typeof LinearIssueSchema.Type, organizationId: string): RemoteFeedback {
  return decodeVendor(RemoteFeedbackSchema, {
    provider: 'linear',
    instance: LINEAR_API,
    organizationId,
    id: issue.id,
    url: normalizedRemoteUrl(issue.url, 'linear'),
    title: normalizeText(issue.title, 4 * 1024, 'Linear'),
    body: normalizeBody(issue.description ?? ''),
    state: normalizeText(issue.state.type || issue.state.name, 128, 'Linear'),
    updatedAt: normalizeDate(issue.updatedAt, 'Linear'),
  }, 'Linear issue');
}

const resolveLinearTeam = Effect.fn('feedback.resolveLinearTeam')(function*(
  connection: Extract<FeedbackConnection, { provider: 'linear' }>,
  credential: string,
  transport: FeedbackTransport,
  budget: FetchBudget,
): Effect.fn.Return<{ readonly organizationId: string; readonly teamId: string }, ConcordError> {
  let cursor: string | null = null;
  const cursors = new Set<string>();
  let organizationId: string | undefined;
  const matches = new Map<string, typeof LinearTeamSchema.Type>();
  do {
    accountPage(budget);
    const data: typeof LinearTeamsDataSchema.Type = yield* graphQl(transport, credential, LINEAR_TEAMS_QUERY, { first: PAGE_SIZE, after: cursor }, LinearTeamsDataSchema, budget);
    organizationId ??= data.viewer.organization.id;
    if (organizationId !== data.viewer.organization.id) return yield* Effect.fail(providerError('ProviderResponseInvalid', 'Linear organization changed during traversal'));
    for (const team of data.teams.nodes) {
      const requested = connection.team.toLocaleLowerCase('en-US');
      if (team.id === connection.teamId || team.id === connection.team || team.key.toLocaleLowerCase('en-US') === requested || team.name.toLocaleLowerCase('en-US') === requested) matches.set(team.id, team);
    }
    if (data.teams.pageInfo.hasNextPage && data.teams.pageInfo.endCursor === null) return yield* Effect.fail(providerError('ProviderResponseInvalid', 'Linear pagination omitted its continuation cursor'));
    const nextCursor = data.teams.pageInfo.hasNextPage ? data.teams.pageInfo.endCursor : null;
    if (nextCursor !== null && cursors.has(nextCursor)) return yield* Effect.fail(providerError('ProviderPaginationCycle', 'Linear repeated a team pagination cursor'));
    if (nextCursor !== null) cursors.add(nextCursor);
    cursor = nextCursor;
  } while (cursor !== null);
  if (organizationId === undefined) return yield* Effect.fail(providerError('ProviderResponseInvalid', 'Linear returned no organization identity'));
  if (connection.organizationId !== undefined && connection.organizationId !== organizationId) {
    return yield* Effect.fail(providerError('ConnectionIdentityMismatch', 'The Linear organization identity no longer matches the bound connection'));
  }
  let teamId: string;
  if (connection.teamId !== undefined) {
    const bound = matches.get(connection.teamId);
    if (bound === undefined) return yield* Effect.fail(providerError('ConnectionIdentityMismatch', 'The Linear team identity no longer matches the bound connection'));
    teamId = bound.id;
  } else {
    if (matches.size === 0) return yield* Effect.fail(providerError('RemoteNotFound', 'The configured Linear team was not found'));
    if (matches.size > 1) return yield* Effect.fail(providerError('FeedbackScopeAmbiguous', 'The configured Linear team name is ambiguous; use its key'));
    teamId = matches.values().next().value!.id;
  }
  return { organizationId, teamId };
});

const fetchLinear = Effect.fn('feedback.fetchLinear')(function*(
  connection: Extract<FeedbackConnection, { provider: 'linear' }>,
  options: FeedbackFetchOptions,
  credential: string,
  transport: FeedbackTransport,
  budget: FetchBudget,
): Effect.fn.Return<{ readonly connection: FeedbackConnection; readonly items: readonly RemoteFeedback[] }, ConcordError> {
  const selected = options.url === undefined ? undefined : parseLinearImport(options.url);
  const scope = yield* resolveLinearTeam(connection, credential, transport, budget);
  const bound: FeedbackConnection = { ...connection, organizationId: scope.organizationId, teamId: scope.teamId };
  const items = new Map<string, RemoteFeedback>();
  if (selected !== undefined) {
    accountPage(budget);
    const data: typeof LinearSingleIssueDataSchema.Type = yield* graphQl(transport, credential, LINEAR_ISSUE_QUERY, { issueId: selected.identifier }, LinearSingleIssueDataSchema, budget);
    accountItems(budget, 1);
    if (data.issue.team.id !== scope.teamId) return yield* Effect.fail(providerError('FeedbackScopeMismatch', 'The Linear issue URL is outside the configured team'));
    const returned = parseLinearImport(data.issue.url);
    if (data.issue.identifier.toLocaleLowerCase('en-US') !== selected.identifier.toLocaleLowerCase('en-US')
      || returned.identifier.toLocaleLowerCase('en-US') !== selected.identifier.toLocaleLowerCase('en-US')
      || returned.workspace.toLocaleLowerCase('en-US') !== selected.workspace.toLocaleLowerCase('en-US')) {
      return yield* Effect.fail(providerError('FeedbackScopeMismatch', 'Linear returned a different issue than the requested URL'));
    }
    keepLatest(items, linearRemote(data.issue, scope.organizationId));
  } else {
    let cursor: string | null = null;
    const cursors = new Set<string>();
    do {
      accountPage(budget);
      const data: typeof LinearIssuesDataSchema.Type = yield* graphQl(transport, credential, LINEAR_ISSUES_QUERY, { first: PAGE_SIZE, after: cursor, teamId: scope.teamId }, LinearIssuesDataSchema, budget);
      accountItems(budget, data.issues.nodes.length);
      for (const issue of data.issues.nodes) {
        if (issue.team.id !== scope.teamId) return yield* Effect.fail(providerError('ProviderResponseInvalid', 'Linear returned an issue outside the requested team'));
        keepLatest(items, linearRemote(issue, scope.organizationId));
      }
      if (data.issues.pageInfo.hasNextPage && data.issues.pageInfo.endCursor === null) return yield* Effect.fail(providerError('ProviderResponseInvalid', 'Linear pagination omitted its continuation cursor'));
      const nextCursor = data.issues.pageInfo.hasNextPage ? data.issues.pageInfo.endCursor : null;
      if (nextCursor !== null && cursors.has(nextCursor)) return yield* Effect.fail(providerError('ProviderPaginationCycle', 'Linear repeated an issue pagination cursor'));
      if (nextCursor !== null) cursors.add(nextCursor);
      cursor = nextCursor;
    } while (cursor !== null);
  }
  return { connection: bound, items: [...items.values()].sort((left, right) => left.id.localeCompare(right.id)) };
});

const fetchFeedbackInternal = Effect.fn('feedback.fetchFeedback')(function*(
  connection: FeedbackConnection,
  options: FeedbackFetchOptions = {},
): Effect.fn.Return<FeedbackFetch, ConcordError> {
  const fetchStartedAt = DateTime.formatIso(yield* DateTime.now);
  const credential = credentialFor(connection, options.credential);
  const transport = options.transport ?? defaultTransport;
  const budget: FetchBudget = { pages: 0, items: 0, bytes: 0 };
  const result = connection.provider === 'github'
    ? yield* fetchGitHub(connection, options, credential, transport, budget)
    : yield* fetchLinear(connection, options, credential, transport, budget);
  const fetchedAt = DateTime.formatIso(yield* DateTime.now);
  return { ...result, fetchStartedAt, fetchedAt };
});

export function fetchFeedback(connection: FeedbackConnection, options?: FeedbackFetchOptions): Effect.Effect<FeedbackFetch, ConcordError> {
  return fetchFeedbackInternal(connection, options).pipe(
    Effect.catchDefect(cause => Effect.fail(cause instanceof ConcordError
      ? cause
      : providerError('ProviderOperationFailed', 'Feedback provider processing failed'))),
    Effect.timeoutOrElse({
      duration: FETCH_TIMEOUT,
      orElse: () => Effect.fail(providerError('ProviderTimeout', 'The feedback provider traversal timed out')),
    }),
  );
}
