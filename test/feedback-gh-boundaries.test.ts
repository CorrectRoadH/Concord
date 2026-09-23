// @concord-file
// @concord-implements docs/feature/feedback/use-case/triage-feedback.md
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Effect } from 'effect';
import type { FeedbackTransport } from '../dist/feedback-providers.js';
import type { FeedbackConnection } from '../dist/feedback-schema.js';

type Scenario = 'trusted-path' | 'missing' | 'old-version' | 'bad-help' | 'bad-protocol' | 'page-failure' | 'budget' | 'cas' | 'normal' | 'switch';
type Call = { readonly args: readonly string[]; readonly outputBytes?: number };

const connection = { id: 'github-main', provider: 'github', transport: 'gh', owner: 'acme', repo: 'widgets' } as const;
const issue = (number: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 1000 + number,
  number,
  html_url: `https://github.com/acme/widgets/issues/${number}`,
  title: `Issue ${number}`,
  body: 'Report',
  state: number % 2 === 0 ? 'closed' : 'open',
  updated_at: '2026-09-14T00:00:00Z',
  ...extra,
});

function calls(path: string): readonly Call[] {
  return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Call) : [];
}

function expectCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function fakeGhSource(modePath: string, callsPath: string, readyPath: string, releasePath: string): string {
  return `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const mode = fs.readFileSync(${JSON.stringify(modePath)}, 'utf8').trim();
function reply(text, status = 0) {
  fs.appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify({ args, outputBytes: Buffer.byteLength(text) }) + '\\n');
  process.stdout.write(text);
  process.exitCode = status;
}
if (args[0] === '--version') reply(mode === 'old-version' ? 'gh version 2.97.0\\n' : 'gh version 2.98.0\\n');
else if (args[0] === 'api' && args[1] === '--help') reply(mode === 'bad-help' ? '--hostname --method\\n' : '--hostname --method --include\\n');
else if (mode === 'bad-protocol') reply('this is not an HTTP response');
else {
  const endpoint = args.at(-1);
  const page = Number(new URL('https://api.github.com/' + endpoint).searchParams.get('page'));
  let status = 200;
  let body;
  if (endpoint === 'repos/acme/widgets') body = { id: 42, full_name: 'acme/widgets' };
  else if (mode === 'page-failure' && page === 2) { status = 503; body = { message: 'temporary failure' }; }
  else if (mode === 'budget') body = Array.from({ length: 100 }, (_, index) => {
    const number = (page - 1) * 100 + index + 1;
    return { id: 1000 + number, number, html_url: 'https://github.com/acme/widgets/issues/' + number, title: 'Issue ' + number, body: 'x'.repeat(17000), state: 'open', updated_at: '2026-09-14T00:00:00Z' };
  });
  else if ((mode === 'page-failure' || mode === 'normal') && page === 1) body = Array.from({ length: 100 }, (_, index) => {
    const number = index + 1;
    return { id: 1000 + number, number, html_url: 'https://github.com/acme/widgets/issues/' + number, title: 'Issue ' + number, body: 'Report', state: number % 2 ? 'open' : 'closed', updated_at: '2026-09-14T00:00:00Z', ...(number === 2 ? { pull_request: { url: 'https://api.github.com/repos/acme/widgets/pulls/2' } } : {}) };
  });
  else if (mode === 'normal' && page === 2) body = [{ id: 1200, number: 200, html_url: 'https://github.com/acme/widgets/issues/200', title: 'Last issue', body: 'Report', state: 'closed', updated_at: '2026-09-14T00:00:00Z' }];
  else body = [{ id: 1001, number: 1, html_url: 'https://github.com/acme/widgets/issues/1', title: 'Issue 1', body: 'Report', state: 'open', updated_at: '2026-09-14T00:00:00Z' }];
  const output = 'HTTP/2 ' + status + ' OK\\r\\ncontent-type: application/json\\r\\n\\r\\n' + JSON.stringify(body);
  if (mode === 'cas' && endpoint.includes('/issues?')) {
    fs.writeFileSync(${JSON.stringify(readyPath)}, 'ready');
    const timer = setInterval(() => { if (fs.existsSync(${JSON.stringify(releasePath)})) { clearInterval(timer); reply(output); } }, 10);
  } else reply(output, status === 200 ? 0 : 1);
}
`;
}

async function child(scenario: Scenario): Promise<void> {
  const temporary = mkdtempSync(join(tmpdir(), 'concord-gh-boundary-'));
  const consumer = join(temporary, 'consumer');
  const trusted = join(temporary, 'trusted');
  const gitBin = join(temporary, 'git-bin');
  const relative = join(temporary, 'relative');
  const modules = join(temporary, 'node_modules', '.bin');
  const symlinkDirectory = join(temporary, 'linked-consumer-bin');
  const linkedExecutable = join(temporary, 'linked-executable');
  const modePath = join(temporary, 'mode');
  const callsPath = join(temporary, 'calls.ndjson');
  const evilMarker = join(temporary, 'evil-marker');
  const readyPath = join(temporary, 'ready');
  const releasePath = join(temporary, 'release');
  mkdirSync(consumer);
  mkdirSync(join(consumer, 'bin'));
  mkdirSync(trusted);
  mkdirSync(gitBin);
  mkdirSync(relative);
  mkdirSync(linkedExecutable);
  mkdirSync(modules, { recursive: true });
  execFileSync('git', ['init', '-q', consumer]);
  symlinkSync(execFileSync('which', ['git'], { encoding: 'utf8' }).trim(), join(gitBin, 'git'));
  writeFileSync(modePath, scenario);
  writeFileSync(join(trusted, 'gh'), fakeGhSource(modePath, callsPath, readyPath, releasePath), { mode: 0o755 });
  const evil = `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(evilMarker)}, 'executed'); process.exit(77);\n`;
  for (const path of [join(temporary, 'gh'), join(relative, 'gh'), join(modules, 'gh'), join(consumer, 'bin', 'gh')]) writeFileSync(path, evil, { mode: 0o755 });
  symlinkSync(join(consumer, 'bin'), symlinkDirectory, 'dir');
  symlinkSync(join(consumer, 'bin', 'gh'), join(linkedExecutable, 'gh'));
  const oldPath = process.env.PATH;
  const oldCwd = process.cwd();
  try {
    process.chdir(temporary);
    process.env.PATH = ['', 'relative', modules, join(consumer, 'bin'), symlinkDirectory, linkedExecutable, gitBin, ...(scenario === 'missing' ? [] : [trusted])].join(delimiter);
    const [{ syncFeedback, listFeedback }, { initialize, LocalRepository }, { setConfig, showConfig }, { ConcordError }] = await Promise.all([
      import('../dist/feedback.js'), import('../dist/storage.js'), import('../dist/editing.js'), import('../dist/shared.js'),
    ]);
    const first = new LocalRepository(consumer, { initialize: true });
    try { initialize(first); } finally { first.close(); }
    const withRepo = <A>(use: (repo: InstanceType<typeof LocalRepository>) => A): A => {
      const repo = new LocalRepository(consumer);
      try { return use(repo); } finally { repo.close(); }
    };
    const configure = (next: FeedbackConnection): void => withRepo(repo => {
      const current = showConfig(repo);
      setConfig(repo, { ...current.config, feedbackConnections: [next] }, current.digest);
    });
    configure(connection);
    const configPath = join(consumer, 'concord.config.ts');
    const originalConfig = readFileSync(configPath, 'utf8');
    const issuePath = join(consumer, 'docs', 'issues', 'feedback-github-1001.md');
    if (scenario === 'trusted-path') process.env.PATH = [join(consumer, 'bin'), modules, gitBin].join(delimiter);
    if (scenario === 'trusted-path' || scenario === 'normal') {
      const result = await Effect.runPromise(syncFeedback(consumer, connection.id));
      assert.equal(result.connection.provider, 'github');
      assert.equal(result.connection.provider === 'github' ? result.connection.repositoryId : undefined, '42');
      if (scenario === 'normal') {
        assert.equal(result.imported, 100);
        assert.equal(existsSync(join(consumer, 'docs/issues/feedback-github-1002.md')), false, 'PR must be excluded');
        assert.equal(existsSync(join(consumer, 'docs/issues/feedback-github-1200.md')), true);
        const endpoints = calls(callsPath).filter(call => call.args[0] === 'api' && call.args[1] !== '--help').map(call => call.args.at(-1));
        assert.deepEqual(endpoints, ['repos/acme/widgets', 'repos/acme/widgets/issues?state=all&per_page=100&page=1', 'repos/acme/widgets/issues?state=all&per_page=100&page=2']);
      }
    } else if (scenario === 'switch') {
      const api: FeedbackTransport = request => Effect.succeed({ status: 200, headers: {}, body: request.url.endsWith('/widgets') ? { id: 42 } : [issue(1)] });
      configure({ id: connection.id, provider: 'github', transport: 'api', credentialEnv: 'FIXTURE_TOKEN', owner: 'acme', repo: 'widgets' });
      const initial = await Effect.runPromise(syncFeedback(consumer, connection.id, { transport: api, credential: 'fixture-token' }));
      assert.equal(initial.imported, 1);
      const originalIssue = readFileSync(issuePath, 'utf8');
      configure({ ...connection, repositoryId: '42' });
      const repeat = await Effect.runPromise(syncFeedback(consumer, connection.id));
      assert.equal(repeat.imported, 0);
      assert.equal(repeat.connection.provider === 'github' ? repeat.connection.repositoryId : undefined, '42');
      assert.equal(readFileSync(issuePath, 'utf8'), originalIssue);
      assert.equal(withRepo(repo => listFeedback(repo).filter(item => item.document.metadata.source !== undefined).length), 1);
    } else if (scenario === 'cas') {
      const running = Effect.runPromise(syncFeedback(consumer, connection.id));
      try {
        for (let attempt = 0; attempt < 300 && !existsSync(readyPath); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
        assert.equal(existsSync(readyPath), true, 'fixture did not reach page read');
        withRepo(repo => {
          const current = showConfig(repo);
          setConfig(repo, { ...current.config, sourceRoots: ['src'] }, current.digest);
        });
      } finally { writeFileSync(releasePath, 'release'); }
      await assert.rejects(running, cause => expectCode(cause, 'PreimageChanged'));
      assert.notEqual(readFileSync(configPath, 'utf8'), originalConfig);
      assert.equal(existsSync(issuePath), false);
      assert.equal(withRepo(repo => repo.config.feedbackConnections?.[0]?.provider === 'github' ? repo.config.feedbackConnections[0].repositoryId : undefined), undefined);
    } else {
      const code = scenario === 'missing' ? 'GhUnavailable' : scenario === 'old-version' || scenario === 'bad-help' || scenario === 'bad-protocol' ? 'GhProtocolInvalid' : scenario === 'budget' ? 'GhLimitExceeded' : 'ProviderRequestFailed';
      await assert.rejects(Effect.runPromise(syncFeedback(consumer, connection.id)), cause => cause instanceof ConcordError && cause.code === code);
      assert.equal(readFileSync(configPath, 'utf8'), originalConfig, 'failure must not bind the connection');
      assert.equal(existsSync(issuePath), false, 'failure must not publish the first page');
      assert.equal(withRepo(repo => listFeedback(repo).filter(item => item.document.metadata.source !== undefined).length), 0);
      if (scenario === 'budget') {
        const pageCalls = calls(callsPath).filter(call => call.args.at(-1)?.includes('/issues?'));
        assert.ok(pageCalls.length >= 9, 'cumulative budget must span many valid pages');
        assert.ok(pageCalls.every(call => (call.outputBytes ?? Infinity) < 2 * 1024 * 1024), 'every fixture page must fit the per-call budget');
      }
      if (scenario === 'page-failure') assert.equal(calls(callsPath).filter(call => call.args.at(-1)?.includes('/issues?')).length, 2);
      if (scenario === 'old-version') assert.deepEqual(calls(callsPath).map(call => call.args[0]), ['--version']);
      if (scenario === 'bad-help') assert.equal(calls(callsPath).some(call => call.args.at(-1) === 'repos/acme/widgets'), false);
    }
    assert.equal(existsSync(evilMarker), false, 'untrusted gh executable ran');
    if (scenario !== 'missing') assert.ok(calls(callsPath).length > 0, 'trusted fake gh was not called');
  } finally {
    process.chdir(oldCwd);
    if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[2] === '--fixture-child') {
  await child(process.argv[3] as Scenario);
} else {
  const entry = fileURLToPath(import.meta.url);
  const run = (scenario: Scenario): void => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', entry, '--fixture-child', scenario], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 60_000 });
    assert.equal(result.status, 0, `${scenario}: ${result.stderr || result.stdout || result.error?.message}`);
  };

  // @use-case docs/feature/feedback/use-case/triage-feedback.md
  test('trusted startup PATH rejects empty, relative, node_modules, consumer and symlink targets', { skip: process.platform === 'win32' }, () => run('trusted-path'));
  test('missing gh, old version, missing API flags and malformed protocol have named failures without fallback', { skip: process.platform === 'win32' }, () => {
    for (const scenario of ['missing', 'old-version', 'bad-help', 'bad-protocol'] as const) run(scenario);
  });
  test('cumulative gh output budget rejects many individually valid pages without publication', { skip: process.platform === 'win32' }, () => run('budget'));
  test('second-page failure does not publish or bind; successful traversal uses all states and excludes PRs', { skip: process.platform === 'win32' }, () => {
    run('page-failure');
    run('normal');
  });
  test('configuration digest drift during gh read prevents publication', { skip: process.platform === 'win32' }, () => run('cas'));
  test('API to gh switch retains repository binding and one imported source', { skip: process.platform === 'win32' }, () => run('switch'));
  test('connection schema rejects credential and transport combinations outside their modes', async () => {
    const [{ FeedbackConnectionSchema }, { decode }] = await Promise.all([import('../dist/feedback-schema.js'), import('../dist/shared.js')]);
    for (const invalid of [
      { ...connection, credentialEnv: 'SHOULD_NOT_BE_ACCEPTED' },
      { ...connection, transport: 'api' },
      { ...connection, executable: '/tmp/gh' },
      { id: 'linear-main', provider: 'linear', transport: 'gh', credentialEnv: 'LINEAR_TOKEN', team: 'ENG' },
    ]) assert.throws(() => decode(FeedbackConnectionSchema, invalid, 'connection fixture'), error => expectCode(error, 'InvalidData'));
  });
}
