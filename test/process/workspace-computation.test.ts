import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { Effect, Fiber } from 'effect';
import { installationRootForBin } from '../../src/base/installation/index.js';
import { installedConcordCli, pollUntil } from '../support/support.js';
import { tmpdir } from '../support/temporary.js';

const installed = async () => {
  const root = installationRootForBin(installedConcordCli());
  return {
    server: await import(pathToFileURL(join(root, 'dist/entry/server/main.js')).href) as typeof import('../../src/entry/server/main.js'),
    publication: await import(pathToFileURL(join(root, 'dist/base/publication/index.js')).href) as typeof import('../../src/base/publication/index.js'),
    cache: await import(pathToFileURL(join(root, 'dist/base/cache/index.js')).href) as typeof import('../../src/base/cache/index.js'),
    app: await import(pathToFileURL(join(root, 'dist/app/index.js')).href) as typeof import('../../src/app/index.js'),
    model: await import(pathToFileURL(join(root, 'dist/model/index.js')).href) as typeof import('../../src/model/index.js'),
  };
};
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-computation-'));
  execFileSync('git', ['init', '-q', root]);
  const result = spawnSync(process.execPath, [installedConcordCli(), '--root', root, '--json', 'init', '--docs-only', '--source-root', 'src'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  mkdirSync(join(root, 'src'));
  for (let i = 0; i < 1072; i++) writeFileSync(join(root, `src/${i}.ts`), `export const value${i} = ${i};\n`);
  return root;
};
const workerPid = (root: string) => pollUntil(async () => {
  for (const line of execFileSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8' }).split('\n')) {
    const row = /^\s*(\d+)\s+(\d+)\s+(.+)$/u.exec(line);
    if (row && Number(row[2]) === process.pid && row[3]!.includes('compute-worker.js') && row[3]!.includes(root)) return Number(row[1]);
  }
  return undefined;
}, { description: 'real installed computation process', timeoutMs: 10_000 });

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
// @name scan-child-termination-releases-exact-token
test('cancelling a queued computation preserves the active child and cancelling its owner confirms group cleanup', { timeout: 30_000 }, async () => {
  const root = fixture(), { server, publication } = await installed();
  const lease = publication.acquireTraceLeaseSync(root, 'shared', 'unrelated-computation-reader')!;
  let pid: number | undefined;
  try {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const owner = yield* server.makeComputationOwner(root);
      const active = yield* Effect.forkScoped(owner.run({ kind: 'scan' }));
      pid = yield* Effect.promise(() => workerPid(root));
      process.kill(pid, 'SIGSTOP');
      const queued = yield* Effect.forkScoped(owner.run({ kind: 'scan' }));
      yield* Fiber.interrupt(queued);
      assert.doesNotThrow(() => process.kill(pid!, 0));
      yield* Fiber.interrupt(active);
      assert.throws(() => process.kill(pid!, 0), { code: 'ESRCH' });
      assert.deepEqual(readdirSync(lease.path), [`${lease.owner.token}.json`]);
      const next = yield* owner.run({ kind: 'scan' });
      assert.ok(typeof next === 'object' && next !== null && 'snapshot' in next);
      assert.ok(existsSync(join(lease.path, `${lease.owner.token}.json`)));
    })).pipe(Effect.provide(server.computationLayer)));
  } finally {
    if (pid !== undefined) try { process.kill(pid, 'SIGCONT'); } catch { /* confirmed reaped */ }
    publication.releaseTraceLeaseSync(lease, 'unrelated-computation-reader');
    rmSync(root, { recursive: true, force: true });
  }
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
// @name scan-generations-do-not-reuse-completed-results
test('later computation generations reuse the idle process but never reuse a completed source result', { timeout: 30_000 }, async () => {
  const root = fixture(), { server, model } = await installed();
  try {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const owner = yield* server.makeComputationOwner(root);
      const first = model.decodeWorkspaceProjectionRecord(yield* owner.run({ kind: 'scan' }));
      const pid = yield* Effect.promise(() => workerPid(root));
      const changed = 'export const changed = true;\n';
      writeFileSync(join(root, 'src/0.ts'), changed);
      const next = model.decodeWorkspaceProjectionRecord(yield* owner.run({ kind: 'scan' }));
      assert.equal(yield* Effect.promise(() => workerPid(root)), pid);
      assert.notEqual(first.snapshot.sources.find(source => source.path === 'src/0.ts')?.digest, next.snapshot.sources.find(source => source.path === 'src/0.ts')?.digest);
      assert.equal(next.snapshot.sources.find(source => source.path === 'src/0.ts')?.digest, model.digest(changed));
    })).pipe(Effect.provide(server.computationLayer)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('a completed workspace scan survives brief contention at publication', { timeout: 30_000 }, async () => {
  const root = fixture(), { server, publication, cache, app, model } = await installed();
  try {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const persistent = yield* cache.PersistentCache.owner(publication.genericPrivateDirectorySync(root));
      yield* persistent.open;
      const computation = yield* server.makeComputationOwner(root);
      const candidate = model.decodeWorkspaceProjectionRecord(yield* computation.run({ kind: 'scan' }, yield* persistent.snapshot));
      assert.throws(() => cache.openHawdb(cache.cacheDatabasePath(publication.genericPrivateDirectorySync(root)), { readOnly: false, create: true }), { code: 'HawdbBusy' });
      let writes = 0;
      const service = { ...persistent.service, update: (...args: Parameters<typeof persistent.service.update>) => { writes++; return persistent.service.update(...args); } };
      const context = yield* app.workspaceProjectionContext(root);
      yield* app.storeWorkspaceProjection(context, candidate).pipe(Effect.provideService(cache.PersistentCache, service));
      const published = yield* app.readWorkspaceProjection(context).pipe(Effect.provideService(cache.PersistentCache, persistent.service));
      assert.equal(published.projection.builtAt, candidate.builtAt);
      assert.equal(writes, 1, 'one completed computation has exactly one durable publication');
    })).pipe(Effect.provide(cache.PersistentCache.layer), Effect.provide(server.computationLayer)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
