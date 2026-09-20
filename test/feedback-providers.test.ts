// @concord-file
// @concord-implements docs/feature/feedback/use-case/triage-feedback.md
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import type { FeedbackConnection } from '../src/feedback-schema.js';
import { fetchFeedback, type FeedbackTransport } from '../src/feedback-providers.js';
import { ConcordError } from '../src/shared.js';

type Request = Parameters<FeedbackTransport>[0];
type Response = { readonly status: number; readonly headers: Readonly<Record<string, string>>; readonly body: unknown };

const githubConnection: FeedbackConnection = {
  id: 'github-main',
  provider: 'github',
  credentialEnv: 'TEST_GITHUB_TOKEN',
  owner: 'acme',
  repo: 'widgets',
};

const organizationId = '11111111-1111-4111-8111-111111111111';
const teamId = '22222222-2222-4222-8222-222222222222';
const issueId = '33333333-3333-4333-8333-333333333333';
const linearConnection: FeedbackConnection = {
  id: 'linear-main',
  provider: 'linear',
  credentialEnv: 'TEST_LINEAR_TOKEN',
  team: 'TEAM',
};

function response(body: unknown, status = 200, headers: Readonly<Record<string, string>> = {}): Response {
  return { status, headers, body };
}

function scripted(responses: readonly Response[], requests: Request[] = []): FeedbackTransport {
  let cursor = 0;
  return request => {
    requests.push(request);
    const next = responses[cursor++];
    return next === undefined
      ? Effect.fail(new ConcordError('UnexpectedRequest', `Unexpected request ${request.method} ${request.url}`))
      : Effect.succeed(next);
  };
}

function githubIssue(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 101,
    number: 7,
    html_url: 'https://github.com/acme/widgets/issues/7',
    title: '  Broken widget  ',
    body: null,
    state: 'open',
    updated_at: '2026-09-14T01:02:03Z',
    vendor_extra: true,
    ...overrides,
  };
}

function linearIssue(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: issueId,
    identifier: 'TEAM-123',
    url: 'https://linear.app/acme/issue/TEAM-123/broken-widget',
    title: 'Broken widget',
    description: null,
    updatedAt: '2026-09-14T01:02:03.456Z',
    state: { type: 'completed', name: 'Done' },
    team: { id: teamId },
    vendorExtra: true,
    ...overrides,
  };
}

function teamsEnvelope(overrides: Readonly<Record<string, unknown>> = {}): unknown {
  return {
    data: {
      viewer: { organization: { id: organizationId } },
      teams: { nodes: [{ id: teamId, key: 'TEAM', name: 'Team' }], pageInfo: { hasNextPage: false, endCursor: null } },
      ...overrides,
    },
  };
}

async function expectConcordError(effect: Effect.Effect<unknown, ConcordError>, code: string): Promise<ConcordError> {
  try {
    await Effect.runPromise(effect);
    assert.fail(`Expected ${code}`);
  } catch (cause) {
    assert.ok(cause instanceof ConcordError, `expected ConcordError, received ${String(cause)}`);
    assert.equal(cause.code, code);
    return cause;
  }
}

// @use-case docs/feature/feedback/use-case/triage-feedback.md
test('GitHub sync binds repository identity, requests all states, filters PRs, and accepts null body', async () => {
  const requests: Request[] = [];
  const transport = scripted([
    response({ id: 9001, ignored: 'allowed' }),
    response([
      githubIssue(),
      githubIssue({ id: 202, number: 8, html_url: 'https://github.com/acme/widgets/issues/8', pull_request: { url: 'https://api.github.com/pulls/8' } }),
    ]),
  ], requests);
  const result = await Effect.runPromise(fetchFeedback(githubConnection, { credential: 'secret-token', transport }));

  assert.equal(result.connection.provider, 'github');
  assert.equal(result.connection.repositoryId, '9001');
  assert.deepEqual(result.items, [{
    provider: 'github',
    instance: 'https://api.github.com',
    id: '101',
    url: 'https://github.com/acme/widgets/issues/7',
    title: 'Broken widget',
    body: '',
    state: 'open',
    updatedAt: '2026-09-14T01:02:03.000Z',
  }]);
  assert.match(requests[1]!.url, /issues\?state=all&per_page=100&page=1$/u);
  assert.equal(requests[0]!.headers.Authorization, 'Bearer secret-token');
  assert.match(result.fetchStartedAt, /Z$/u);
  assert.match(result.fetchedAt, /Z$/u);
});

// @use-case docs/feature/feedback/use-case/triage-feedback.md
test('GitHub single import rejects PR URLs, malformed encoding, and a different returned issue', async () => {
  for (const url of [
    'https://github.com/acme/widgets/pull/7',
    'https://github.com/acme/widgets/issues/%ZZ',
    'https://example.com/acme/widgets/issues/7',
  ]) {
    const requests: Request[] = [];
    const code = url.includes('/pull/') ? 'PullRequestUnsupported' : 'UnsupportedFeedbackUrl';
    await expectConcordError(fetchFeedback(githubConnection, { url, credential: 'token', transport: scripted([], requests) }), code);
    assert.equal(requests.length, 0);
  }

  const transport = scripted([
    response({ id: 9001 }),
    response(githubIssue({ number: 8, html_url: 'https://github.com/acme/widgets/issues/8' })),
  ]);
  await expectConcordError(fetchFeedback(githubConnection, {
    url: 'https://github.com/acme/widgets/issues/7', credential: 'token', transport,
  }), 'FeedbackScopeMismatch');
});

// @use-case docs/feature/feedback/use-case/triage-feedback.md
test('bound immutable provider identity mismatches abort the fetch', async () => {
  await expectConcordError(fetchFeedback({ ...githubConnection, repositoryId: '42' }, {
    credential: 'token', transport: scripted([response({ id: 43 })]),
  }), 'ConnectionIdentityMismatch');

  await expectConcordError(fetchFeedback({ ...linearConnection, organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, {
    credential: 'token', transport: scripted([response(teamsEnvelope())]),
  }), 'ConnectionIdentityMismatch');
});

// @use-case docs/feature/feedback/use-case/triage-feedback.md
test('HTTP and GraphQL rate limits are classified without treating every 400/403 as rate limited', async () => {
  await expectConcordError(fetchFeedback(githubConnection, {
    credential: 'token', transport: scripted([response({}, 403)]),
  }), 'ProviderRequestFailed');
  await expectConcordError(fetchFeedback(githubConnection, {
    credential: 'token', transport: scripted([response({}, 403, { 'X-RateLimit-Remaining': '0' })]),
  }), 'RateLimited');
  await expectConcordError(fetchFeedback(linearConnection, {
    credential: 'token', transport: scripted([response({ errors: [{ message: 'slow down', extensions: { code: 'RATELIMITED' } }] }, 400)]),
  }), 'RateLimited');
  await expectConcordError(fetchFeedback(linearConnection, {
    credential: 'token', transport: scripted([response({ errors: [{ message: 'bad query', extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } }] }, 400)]),
  }), 'ProviderGraphQlFailed');
  await expectConcordError(fetchFeedback(linearConnection, {
    credential: 'token', transport: scripted([response({}, 503, { 'Retry-After': '1' })]),
  }), 'ProviderRequestFailed');
});

// @use-case docs/feature/feedback/use-case/triage-feedback.md
test('Linear sync uses the official GraphQL endpoint, raw personal key, archived traversal, and actual scope IDs', async () => {
  const requests: Request[] = [];
  const transport = scripted([
    response(teamsEnvelope()),
    response({ data: { issues: { nodes: [linearIssue()], pageInfo: { hasNextPage: false, endCursor: null } } } }),
  ], requests);
  const result = await Effect.runPromise(fetchFeedback(linearConnection, { credential: 'personal-api-key', transport }));

  assert.equal(requests.length, 2);
  assert.equal(requests[0]!.url, 'https://api.linear.app/graphql');
  assert.equal(requests[0]!.headers.Authorization, 'personal-api-key');
  assert.doesNotMatch(requests[0]!.headers.Authorization!, /^Bearer /u);
  assert.match(requests[0]!.body!, /teams\(first: \$first, after: \$after, includeArchived: true\)/u);
  assert.match(requests[1]!.body!, /issues\(first: \$first, after: \$after, includeArchived: true/u);
  assert.match(requests[1]!.body!, /\$teamId: ID!/u);
  assert.deepEqual(result.connection, { ...linearConnection, organizationId, teamId });
  assert.deepEqual(result.items, [{
    provider: 'linear',
    instance: 'https://api.linear.app',
    organizationId,
    id: issueId,
    url: 'https://linear.app/acme/issue/TEAM-123/broken-widget',
    title: 'Broken widget',
    body: '',
    state: 'completed',
    updatedAt: '2026-09-14T01:02:03.456Z',
  }]);
});

// @use-case docs/feature/feedback/use-case/triage-feedback.md
test('Linear import verifies returned team, workspace, and identifier', async () => {
  const transport = scripted([
    response(teamsEnvelope()),
    response({ data: { issue: linearIssue({ url: 'https://linear.app/other/issue/TEAM-123/broken-widget' }) } }),
  ]);
  await expectConcordError(fetchFeedback(linearConnection, {
    url: 'https://linear.app/acme/issue/TEAM-123/broken-widget', credential: 'token', transport,
  }), 'FeedbackScopeMismatch');

  const requests: Request[] = [];
  await expectConcordError(fetchFeedback(linearConnection, {
    url: 'https://linear.app/acme/issue/%ZZ', credential: 'token', transport: scripted([], requests),
  }), 'UnsupportedFeedbackUrl');
  assert.equal(requests.length, 0);
});

// @use-case docs/feature/feedback/use-case/triage-feedback.md
test('repeated identities retain the latest update and reject equal-version conflicts', async () => {
  const latest = await Effect.runPromise(fetchFeedback(githubConnection, {
    credential: 'token',
    transport: scripted([
      response({ id: 9001 }),
      response([
        githubIssue({ title: 'old', updated_at: '2026-09-13T01:00:00Z' }),
        githubIssue({ title: 'new', updated_at: '2026-09-14T01:00:00Z' }),
      ]),
    ]),
  }));
  assert.equal(latest.items[0]!.title, 'new');

  await expectConcordError(fetchFeedback(githubConnection, {
    credential: 'token',
    transport: scripted([
      response({ id: 9001 }),
      response([githubIssue({ title: 'one' }), githubIssue({ title: 'two' })]),
    ]),
  }), 'RemoteIdentityConflict');
});

// @use-case docs/feature/feedback/use-case/triage-feedback.md
test('missing credentials and oversized transport responses fail with named safe errors', async () => {
  const prior = process.env.TEST_GITHUB_TOKEN;
  delete process.env.TEST_GITHUB_TOKEN;
  try {
    await expectConcordError(fetchFeedback(githubConnection, { transport: scripted([]) }), 'CredentialMissing');
  } finally {
    if (prior !== undefined) process.env.TEST_GITHUB_TOKEN = prior;
  }

  const error = await expectConcordError(fetchFeedback(githubConnection, {
    credential: 'never-print-this-token',
    transport: scripted([response('x'.repeat(2 * 1024 * 1024 + 1))]),
  }), 'ProviderLimitExceeded');
  assert.doesNotMatch(error.message, /never-print-this-token/u);
});

// @use-case docs/feature/feedback/use-case/triage-feedback.md
test('GitHub follows a full first page and aborts the whole fetch when a later page fails', async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => githubIssue({
    id: index + 1,
    number: index + 1,
    html_url: `https://github.com/acme/widgets/issues/${index + 1}`,
  }));
  const requests: Request[] = [];
  const successful = await Effect.runPromise(fetchFeedback(githubConnection, {
    credential: 'token',
    transport: scripted([
      response({ id: 9001 }),
      response(firstPage),
      response([githubIssue({ id: 101, number: 101, html_url: 'https://github.com/acme/widgets/issues/101' })]),
    ], requests),
  }));
  assert.equal(successful.items.length, 101);
  assert.match(requests[2]!.url, /page=2$/u);

  let call = 0;
  const laterFailure: FeedbackTransport = request => {
    call += 1;
    if (call === 1) return Effect.succeed(response({ id: 9001 }));
    if (call === 2) return Effect.succeed(response(firstPage));
    return Effect.fail(new ConcordError('UpstreamInterrupted', 'second page unavailable'));
  };
  await expectConcordError(fetchFeedback(githubConnection, { credential: 'token', transport: laterFailure }), 'UpstreamInterrupted');
  assert.equal(call, 3);
});

// @use-case docs/feature/feedback/use-case/triage-feedback.md
test('Linear follows cursors and rejects HTTP 200 partial data accompanied by GraphQL errors', async () => {
  const requests: Request[] = [];
  const paged = await Effect.runPromise(fetchFeedback(linearConnection, {
    credential: 'token',
    transport: scripted([
      response(teamsEnvelope()),
      response({ data: { issues: { nodes: [linearIssue()], pageInfo: { hasNextPage: true, endCursor: 'issues-next' } } } }),
      response({ data: { issues: { nodes: [linearIssue({
        id: '44444444-4444-4444-8444-444444444444',
        identifier: 'TEAM-124',
        url: 'https://linear.app/acme/issue/TEAM-124/another-widget',
      })], pageInfo: { hasNextPage: false, endCursor: null } } } }),
    ], requests),
  }));
  assert.equal(paged.items.length, 2);
  assert.match(requests[2]!.body!, /"after":"issues-next"/u);

  await expectConcordError(fetchFeedback(linearConnection, {
    credential: 'token',
    transport: scripted([
      response(teamsEnvelope()),
      response({
        data: { issues: { nodes: [linearIssue()], pageInfo: { hasNextPage: false, endCursor: null } } },
        errors: [{ message: 'one field failed', extensions: { code: 'INTERNAL_ERROR' } }],
      }),
    ]),
  }), 'ProviderGraphQlFailed');
});

// @use-case docs/feature/feedback/use-case/triage-feedback.md
test('repeated cursors and indefinitely full GitHub pages terminate with explicit bounds', async () => {
  let linearCalls = 0;
  const repeatedCursor: FeedbackTransport = () => {
    linearCalls += 1;
    return Effect.succeed(response({
      data: {
        viewer: { organization: { id: organizationId } },
        teams: {
          nodes: [{ id: teamId, key: 'TEAM', name: 'Team' }],
          pageInfo: { hasNextPage: true, endCursor: 'same-cursor' },
        },
      },
    }));
  };
  await expectConcordError(fetchFeedback(linearConnection, { credential: 'token', transport: repeatedCursor }), 'ProviderPaginationCycle');
  assert.equal(linearCalls, 2);

  const fullPage = Array.from({ length: 100 }, (_, index) => githubIssue({
    id: index + 1,
    number: index + 1,
    html_url: `https://github.com/acme/widgets/issues/${index + 1}`,
  }));
  let githubCalls = 0;
  const neverEndingPages: FeedbackTransport = () => {
    githubCalls += 1;
    return Effect.succeed(githubCalls === 1 ? response({ id: 9001 }) : response(fullPage));
  };
  await expectConcordError(fetchFeedback(githubConnection, { credential: 'token', transport: neverEndingPages }), 'ProviderLimitExceeded');
  assert.ok(githubCalls > 1 && githubCalls < 150, `expected bounded requests, received ${githubCalls}`);
});
