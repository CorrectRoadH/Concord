import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { before, after } from 'node:test';
import { Effect } from 'effect';
import { packConcord, installConcord } from './installed-package.js';
import { cacheDatabasePath } from '../dist/cache-file.js';
import { openHawdb } from '../dist/hawdb-native.js';
import { readProjectConfig, writeProjectConfig } from './support.js';
import { LocalRepository, initialize } from '../dist/storage.js';
import { createDocument, setAuthor } from '../dist/documents.js';
import { ConcordError, digest } from '../dist/shared.js';
import { queryContext, readQuery, storeQuery } from '../dist/query-cache.js';

const gaps = (marker = 'original') => ({ operation: 'trace-gaps' as const, semantics: 'missing-explicit-relationships-not-coverage' as const, limitations: [marker], contracts: [], cliPages: [], cache: { status: 'off', hits: 0, misses: 0, path: 'cache' } });
const candidate = (marker = 'original', scannedAt = Date.now()) => ({ kind: 'candidate' as const, message: { format: 'concord.query-scan/v1' as const, ok: true as const, scannedAt, finishedAt: Date.now(), value: gaps(marker), complete: true, unknown: [], drift: { files: [], directories: [], publicationChanged: false } } });
function consumer(): string {
  const root = mkdtempSync(join(tmpdir(), 'concord-async-projections-'));
  execFileSync('git', ['init', '-q', root]);
  const repo = new LocalRepository(root, { initialize: true });
  try { initialize(repo, false, { testRoots: [], sourceRoots: ['src'] }); createDocument(repo, 'feature', { id: 'sample', title: 'Sample' }); }
  finally { repo.close(); }
  return root;
}
const cli = resolve('dist/entry.js');
const call = (root: string, ...args: string[]) => spawnSync(process.execPath, [cli, '--root', root, '--json', ...args], { encoding: 'utf8', timeout: 125_000 });
async function historicalCall(root: string) {
  const deadline = Date.now() + 10_000;
  while (true) {
    const result = call(root, 'trace', 'gaps');
    if (result.status === 0 || Date.now() >= deadline) return result;
    assert.equal(JSON.parse(result.stderr).error, 'HawdbBusy', result.stderr);
    await Effect.runPromise(Effect.sleep('100 millis'));
  }
}

// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
test('failed refresh retains a full oldest snapshot at namespace capacity and success clears its error', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer();
  try {
    const context = queryContext(root, ['trace', 'gaps']);
    storeQuery(context, candidate());
    for (let i = 0; i < 63; i++) storeQuery({ ...context, key: `other-${i}` }, candidate(String(i)));
    storeQuery(context, { kind: 'failure', error: { failedAt: new Date().toISOString(), scannedAt: Date.now(), code: 'QueryRefreshFailed', message: 'failed scan' } });
    const failed = readQuery(context);
    assert.deepEqual(failed.record?.value, gaps());
    assert.equal(failed.error?.code, 'QueryRefreshFailed');
    storeQuery(context, candidate('refreshed'));
    const succeeded = readQuery(context);
    assert.deepEqual(succeeded.record?.value, gaps('refreshed'));
    assert.equal(succeeded.error, undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
test('a newly stored snapshot from an older scan does not consume a later refresh request', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer();
  try {
    const context = queryContext(root, ['trace', 'gaps']);
    const requestedAt = Date.now() - 100;
    storeQuery(context, candidate('obsolete', requestedAt - 1000));
    const result = spawnSync(process.execPath, [resolve('dist/query-refresh-worker.js'), root, JSON.stringify(context.query), String(requestedAt)], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, 0, result.stderr);
    const refreshed = readQuery(context);
    assert.ok(refreshed.record && refreshed.record.scannedAt >= requestedAt, JSON.stringify(refreshed));
    assert.notDeepEqual(refreshed.record.value, gaps('obsolete'));
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('directory observations detect a size change even when an oversized file was not read', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer();
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'large.ts'), 'x'.repeat(1024 * 1024 + 1));
  const reader = new LocalRepository(root, { access: 'read' });
  try {
    reader.beginSnapshot(); reader.files('src');
    writeFileSync(join(root, 'src', 'large.ts'), '// @feature docs/feature/sample/README.md\n');
    assert.throws(() => reader.verifySnapshot(), { code: 'PreimageChanged' });
  } finally { reader.close(); rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('source reads do not own a lease and detect a concurrent successful publication', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer();
  const reader = new LocalRepository(root, { access: 'read' });
  try {
    reader.beginSnapshot();
    const path = 'docs/feature/sample/README.md';
    const before = reader.read(path)!;
    assert.equal(existsSync(join(root, '.git/concord/trace/publication.lease')), false);
    const writer = new LocalRepository(root, { optimistic: true });
    try { setAuthor(writer, path, '# Changed\n', digest(before)); }
    finally { writer.close(); }
    assert.match(readFileSync(join(root, path), 'utf8'), /Changed/);
    assert.throws(() => reader.verifySnapshot(), { code: 'SourceChanged' });
  } finally { reader.close(); rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('concurrent optimistic plans reject the losing writer without overwriting the winner', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer();
  const first = new LocalRepository(root, { optimistic: true });
  const second = new LocalRepository(root, { optimistic: true });
  const path = 'docs/feature/sample/README.md';
  try {
    first.beginSnapshot(); second.beginSnapshot();
    const before = first.read(path)!; second.read(path);
    setAuthor(first, path, '# First\n', digest(before));
    assert.throws(() => setAuthor(second, path, '# Second\n', digest(before)), { code: 'PreimageChanged' });
    assert.match(readFileSync(join(root, path), 'utf8'), /First/);
    assert.equal(existsSync(join(root, '.git/concord/journal.json')), false);
  } finally { first.close(); second.close(); rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('a complete A-B-A publication is detected before the writer releases ownership', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer();
  const writer = new LocalRepository(root);
  const reader = new LocalRepository(root, { access: 'read' });
  const path = 'docs/feature/sample/README.md';
  try {
    writer.beginSnapshot();
    reader.beginSnapshot();
    const before = reader.read(path)!;
    writer.publish('test-edit', [{ path, before, after: `${before}\nchanged\n` }]);
    writer.publish('test-edit', [{ path, before: `${before}\nchanged\n`, after: before }]);
    assert.equal(readFileSync(join(root, path), 'utf8'), before);
    assert.throws(() => reader.verifySnapshot(), { code: 'SourceChanged' });
    assert.ok(existsSync(join(root, '.git/concord/trace/publication.lease')));
  } finally { reader.close(); writer.close(); rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
test('CLI exits before refresh, serves a historical snapshot, and keeps fresh checks authoritative', async () => {
  const root = consumer();
  mkdirSync(join(root, 'src'));
  for (let i = 0; i < 1072; i++) writeFileSync(join(root, 'src', `${i}.ts`), `export const value${i} = ${i};\n`);
  const context = queryContext(root, ['trace', 'gaps']);
  try {
    const cold = call(root, 'trace', 'gaps');
    assert.equal(cold.status, 1, cold.stderr);
    assert.match(cold.stderr, /QueryPending/);
    const deadline = Date.now() + 125_000;
    let cached = readQuery(context);
    while (!cached.record && Date.now() < deadline) {
      await Effect.runPromise(Effect.sleep('100 millis'));
      cached = readQuery(context);
    }
    assert.ok(cached.record, JSON.stringify(cached));
    for (let i = 0; i < 4; i++) {
      const hit = await historicalCall(root);
      assert.equal(hit.status, 0, `Background source scanning must leave query projections readable: ${hit.stderr}`);
      assert.equal(JSON.parse(hit.stdout).projection.current, false);
    }
    const path = join(root, 'docs/feature/sample/README.md');
    const source = readFileSync(path, 'utf8');
    writeFileSync(path, '---\nformat: concord.document/v1\nkind: feature\n---\n# Broken\n');
    const historical = await historicalCall(root);
    assert.equal(historical.status, 0, historical.stderr);
    assert.equal(JSON.parse(historical.stdout).projection.current, false);
    const check = call(root, 'check');
    assert.equal(check.status, 1, check.stdout + check.stderr);
    assert.equal(JSON.parse(check.stdout).ok, false);
    const fresh = call(root, '--fresh', 'trace', 'gaps');
    assert.equal(fresh.status, 1, fresh.stdout + fresh.stderr);
    assert.match(fresh.stderr, /TraceInvalid/);
    const failedDeadline = Date.now() + 125_000;
    let failed = readQuery(context);
    while (!failed.error && Date.now() < failedDeadline) {
      await Effect.runPromise(Effect.sleep('100 millis'));
      failed = readQuery(context);
    }
    assert.ok(failed.error, JSON.stringify(failed));
    assert.deepEqual(failed.record?.value, cached.record.value, 'failed refresh retains the complete prior diagnostic content');
    writeFileSync(path, source);
  } finally { await waitForRefreshExit(root); rmSync(root, { recursive: true, force: true }); }
});


/** Only processes naming this isolated consumer are owned by this test. */
async function waitForRefreshExit(root: string): Promise<void> {
  const active = () => execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n')
    .filter(line => line.includes(root) && /query-(refresh|scan)-worker\.js/u.test(line)).map(line => Number(line.trim().split(/\s/u)[0]));
  const deadline = Date.now() + 125_000;
  while (active().length && Date.now() < deadline) await Effect.runPromise(Effect.sleep('100 millis'));
  for (const pid of active()) { try { process.kill(pid, 'SIGTERM'); } catch { /* Already exited. */ } }
  const cleanupDeadline = Date.now() + 5_000;
  while (active().length && Date.now() < cleanupDeadline) await Effect.runPromise(Effect.sleep('100 millis'));
  assert.deepEqual(active(), [], 'Owned refresh processes must exit before deleting their consumer');
}

let packageScratch = '', installedCli = '';
before(() => Effect.runPromise(Effect.sync(() => {
  packageScratch = mkdtempSync(join(tmpdir(), 'concord-drift-installed-'));
  const packed = packConcord(packageScratch);
  const tool = join(packageScratch, 'tool'); mkdirSync(tool);
  writeFileSync(join(tool, 'package.json'), JSON.stringify({ private: true }));
  installConcord(tool, packed);
  installedCli = join(tool, 'node_modules/concord-sdlc/dist/entry.js');
})));
after(() => Effect.runPromise(Effect.sync(() => { if (packageScratch) rmSync(packageScratch, { recursive: true, force: true }); })));
const installedCall = (root: string, ...args: string[]) => spawnSync(process.execPath, [installedCli, '--root', root, ...args], { encoding: 'utf8', timeout: 30_000 });
function packedConsumer(workload = true): string {
  const root = mkdtempSync(join(tmpdir(), 'concord-drift-consumer-'));
  execFileSync('git', ['init', '-q', root]);
  const initialized = installedCall(root, '--json', 'init', '--test-root', 'test', '--source-root', 'src');
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.equal(installedCall(root, '--json', 'feature', 'create', 'sample', '--title', 'Sample').status, 0);
  mkdirSync(join(root, 'src')); mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'src/000.ts'), '// @concord-file\n// @concord-implements docs/feature/sample/README.md\nexport const first = 1;\n');
  writeFileSync(join(root, 'test/000.ts'), '// @feature docs/feature/sample/README.md\nexport const first = 1;\n');
  if (workload) for (let i = 1; i <= 250; i++) {
    writeFileSync(join(root, `src/${String(i).padStart(3, '0')}.ts`), `export const value${i} = ${i};\n`);
    writeFileSync(join(root, `test/${String(i).padStart(3, '0')}.ts`), `// @feature docs/feature/sample/README.md\nexport const test${i} = ${i};\n`);
  }
  return root;
}
function refreshInstalled(root: string, query: readonly string[], limitMs?: number) {
  return new Promise<{ status: number | null; stderr: string }>((resolveResult, reject) => {
    const worker = join(installedCli, '../query-refresh-worker.js');
    const child = spawn(process.execPath, [worker, root, JSON.stringify(query), String(Date.now()), ...(limitMs === undefined ? [] : [String(limitMs)])], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = ''; child.stderr.on('data', data => { stderr += String(data); });
    child.once('error', reject); child.once('close', status => resolveResult({ status, stderr }));
  });
}

// @use-case docs/feature/local-sdlc/use-case/discover-annotated-tests.md
test('packed CLI discovers real sources without reading environment files or following environment links', async () => {
  const root = packedConsumer(false);
  try {
    for (const base of ['src', 'test']) {
      symlinkSync(join(root, 'missing-secret'), join(root, base, '.env'));
      writeFileSync(join(root, base, '.env.local'), '// @feature docs/feature/absent/README.md\n');
      mkdirSync(join(root, base, '.env.production'));
      symlinkSync(root, join(root, base, '.env.production/cycle'));
      mkdirSync(join(root, base, 'dist'));
      writeFileSync(join(root, base, 'dist/bundle.js'), '// @feature docs/feature/generated/README.md\n');
      symlinkSync(root, join(root, base, 'dist/cycle'));
    }
    for (const args of [['trace', 'gaps', '--fresh'], ['trace', 'check'], ['test', 'list'], ['code', 'list']] as const) {
      const result = installedCall(root, '--json', ...args);
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.doesNotMatch(result.stdout, /missing-secret|absent\/README|generated\/README|\.env/u);
    }
    const refreshed = await refreshInstalled(root, ['trace', 'gaps']);
    assert.equal(refreshed.status, 0, refreshed.stderr);
    // Read through the packed public CLI after the background scan has published.
    const historical = installedCall(root, '--json', 'trace', 'gaps');
    assert.equal(historical.status, 0, historical.stderr);
    assert.equal(JSON.parse(historical.stdout).projection.current, false);
    await waitForRefreshExit(root);
    symlinkSync(join(root, 'src/000.ts'), join(root, 'src/linked.ts'));
    const rejected = installedCall(root, '--json', 'trace', 'gaps', '--fresh');
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /UnsafePath/u);
  } finally { await waitForRefreshExit(root); rmSync(root, { recursive: true, force: true }); }
});
async function editing(root: string, relative: string) {
  // An independent external writer is the only simulated boundary; all scanning and publication use the packed implementation.
  const child = spawn(process.execPath, ['--input-type=module', '-e', String.raw`import { readFileSync, writeFileSync, renameSync } from 'node:fs';
const path = process.argv[1], temporary = process.argv[2], source = readFileSync(path, 'utf8'); let counter = 0;
const edit = () => { writeFileSync(temporary, source + (path.endsWith('.md') ? '\n<!-- edit ' : '\n// edit ') + (++counter) + (path.endsWith('.md') ? ' -->\n' : '\n')); renameSync(temporary, path); };
edit(); process.stdout.write('ready'); setInterval(edit, 2);`, join(root, relative), join(root, '.git/drift-writer.tmp')], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise<void>((resolveReady, reject) => { child.stdout.once('data', () => resolveReady()); child.once('error', reject); child.once('exit', code => reject(new Error(`Writer exited before ready: ${code}`))); });
  return async () => { const exited = new Promise<void>(resolveExit => child.once('close', () => resolveExit())); child.kill('SIGTERM'); await exited; };
}

// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
test('packed C1 publishes cold projections during continuous docs, test, and code edits', async () => {
  for (const relative of ['docs/feature/sample/README.md', 'test/000.ts', 'src/000.ts']) {
    const root = packedConsumer();
    let stop: (() => Promise<void>) | undefined;
    try {
      stop = await editing(root, relative);
      const result = await refreshInstalled(root, ['trace', 'gaps']);
      assert.equal(result.status, 0, result.stderr);
      const context = queryContext(root, ['trace', 'gaps']);
      const stored = readQuery(context);
      assert.ok(stored.record, JSON.stringify(stored));
      assert.equal(stored.record.consistent, false);
      assert.equal(stored.record.complete, false);
      assert.equal(stored.record.unknownRelations, true);
      // CodeSourceChanged may report an unknown range ('.'). A successful stable
      // recompilation retains known code relationships even when source drifted.
      assert.ok(stored.record.changedPaths.includes(relative)
        || relative.startsWith('src/') && stored.record.changedPaths.includes('.'), JSON.stringify(stored));
      const shown = installedCall(root, '--json', 'trace', 'gaps');
      assert.equal(shown.status, 0, shown.stderr);
      assert.equal(JSON.parse(shown.stdout).projection.consistent, false);
      const human = installedCall(root, 'trace', 'gaps');
      assert.equal(human.status, 0, human.stderr);
      assert.match(human.stdout, /关系可能不完整/u);
    } finally { if (stop) await stop(); await waitForRefreshExit(root); rmSync(root, { recursive: true, force: true }); }
  }
});

// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
test('packed C2 retains the consistent generation and annotates the later drifting attempt', async () => {
  const root = packedConsumer();
  let stop: (() => Promise<void>) | undefined;
  try {
    const context = queryContext(root, ['trace', 'gaps']);
    assert.equal((await refreshInstalled(root, ['trace', 'gaps'])).status, 0);
    const previous = readQuery(context).record;
    assert.ok(previous?.consistent);
    stop = await editing(root, 'docs/feature/sample/README.md');
    assert.equal((await refreshInstalled(root, ['trace', 'gaps'])).status, 0);
    const retained = readQuery(context);
    assert.deepEqual(retained.record, previous);
    assert.equal(retained.lastAttempt?.complete, false);
    assert.ok(retained.lastAttempt?.changedPaths.includes('docs/feature/sample/README.md'));
    assert.equal(retained.error, undefined);
    const result = installedCall(root, 'trace', 'gaps');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /此后的刷新在编辑中未能取得一致结果/u);
  } finally { if (stop) await stop(); await waitForRefreshExit(root); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
test('packed C3 internal short deadline preserves timeout details with and without a generation', async () => {
  for (const warm of [false, true]) {
    const root = packedConsumer();
    try {
      const context = queryContext(root, ['trace', 'gaps']);
      if (warm) assert.equal((await refreshInstalled(root, ['trace', 'gaps'])).status, 0);
      const previous = readQuery(context).record;
      const result = await refreshInstalled(root, ['trace', 'gaps'], 100);
      assert.equal(result.status, 0, result.stderr);
      const timedOut = readQuery(context);
      assert.equal(timedOut.error?.code, 'QueryRefreshTimedOut', JSON.stringify(timedOut));
      assert.equal(timedOut.error.limitMs, 100);
      assert.ok(timedOut.error.elapsedMs! >= 100);
      assert.deepEqual(timedOut.record, previous);
      const shown = installedCall(root, '--json', 'trace', 'gaps');
      assert.equal(shown.status, warm ? 0 : 1, shown.stdout + shown.stderr);
      const error = warm ? JSON.parse(shown.stdout).projection.lastError : JSON.parse(shown.stderr).details.refresh;
      assert.equal(error.code, 'QueryRefreshTimedOut');
    } finally { await waitForRefreshExit(root); rmSync(root, { recursive: true, force: true }); }
  }
});

// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
test('packed C7 persists no owner or remote bodies and hydrates byte-identical current output', async () => {
  const root = packedConsumer(false);
  try {
    const ownerPath = 'docs/feature/sample/README.md';
    writeFileSync(join(root, ownerPath), readFileSync(join(root, ownerPath), 'utf8') + '\nPRIVATE_OWNER_BODY_SENTINEL\n');
    writeFileSync(join(root, 'docs/constitution.md'), readFileSync(join(root, 'docs/constitution.md'), 'utf8') + '\nPRIVATE_CONSTITUTION_BODY_SENTINEL\n');
    const repo = new LocalRepository(root);
    try {
      createDocument(repo, 'issue', { id: 'remote', title: 'Remote', body: '# PRIVATE_ISSUE_BODY_SENTINEL\n' });
    } finally { repo.close(); }
    const issuePath = join(root, 'docs/issues/remote.md');
    const source = readFileSync(issuePath, 'utf8');
    writeFileSync(issuePath, source.replace('kind: issue', `kind: issue
source:
  provider: github
  instance: https://api.github.com
  id: '123'
  url: https://github.com/example/example/issues/1
  title: Remote
  body: PRIVATE_REMOTE_BODY_SENTINEL
  state: open
  updatedAt: 2026-10-06T00:00:00.000Z
  connectionId: github
  importedAt: 2026-10-06T00:00:00.000Z`));
    for (const query of [['trace', 'show', ownerPath], ['trace', 'show', 'docs/issues/remote.md'], ['review', 'render', 'sample']] as const) {
      const result = await refreshInstalled(root, query);
      assert.equal(result.status, 0, result.stderr);
      const context = queryContext(root, query);
      const stored = readQuery(context);
      assert.ok(stored.record, JSON.stringify(stored));
      const db = openHawdb(cacheDatabasePath(context.privateDir), { readOnly: true, create: false });
      try { assert.doesNotMatch(db.get('query_cache', [context.key])[0]!.payload, /PRIVATE_(OWNER|CONSTITUTION|ISSUE|REMOTE)_BODY_SENTINEL/u); } finally { db.close(); }
      const current = installedCall(root, '--json', '--fresh', '--dry-run', ...query);
      const historical = installedCall(root, '--json', ...query);
      assert.equal(current.status, 0, current.stderr);
      assert.equal(historical.status, 0, historical.stderr);
      assert.doesNotMatch(current.stdout + historical.stdout, /relationsUnknown|codeRelationsUnknown/u);
      const output = JSON.parse(historical.stdout);
      if (query[0] === 'review') assert.equal(output.body, JSON.parse(current.stdout));
      else {
        const { projection: _projection, cache: _cache, ...old } = output;
        const { cache: _freshCache, ...fresh } = JSON.parse(current.stdout);
        assert.equal(JSON.stringify(old), JSON.stringify(fresh));
      }
      await waitForRefreshExit(root);
    }
    writeFileSync(join(root, ownerPath), readFileSync(join(root, ownerPath), 'utf8') + '\nchanged\n');
    const changed = installedCall(root, '--json', 'trace', 'show', ownerPath);
    const changedValue = JSON.parse(changed.stdout);
    assert.deepEqual(changedValue.projection.bodyChanged, [ownerPath]);
    assert.equal(changedValue.subject.body, undefined);
    await waitForRefreshExit(root);
    writeFileSync(join(root, 'docs/constitution.md'), readFileSync(join(root, 'docs/constitution.md'), 'utf8') + '\nchanged\n');
    const review = JSON.parse(installedCall(root, '--json', 'review', 'render', 'sample').stdout);
    assert.deepEqual(review.projection.bodyChanged, ['docs/constitution.md']);
    assert.match(review.body, /constitution changed since projection/u);
  } finally { await waitForRefreshExit(root); rmSync(root, { recursive: true, force: true }); }
});
