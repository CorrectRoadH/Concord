import { runApplication } from '../support/repository.js';
import { makeOwnedProcessService, installationResources, installationRootForBin, classifyQueryRefresh, persist, pathToFileURL, packageBin, createConsumer, genericPrivateDirectorySync, refreshQuery, pollUntil, decodeDocumentSource, workerEntryArgv, installedConcordCli, assert, execFileSync, spawn, spawnSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, tmpdir, join, resolve, test, before, after, Effect, Schema, packConcord, installConcord, cacheDatabasePath, openHawdb, readProjectConfig, writeProjectConfig, LocalRepository, initialize, setAuthor, createDocument, renderDocument, ConcordError, digest, QueryCacheEnvelope, queryContext, readQuery, storeQuery, type Query, gaps, candidate, consumer, cli, call, historicalCall, waitForRefreshExit, packageScratch, installedCli, installedCall, packedConsumer, packedEnvelope, refreshInstalled, editing } from '../support/asynchronous-projections-fixture.js';


// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
test('a newly stored snapshot from an older scan does not consume a later refresh request', () => runApplication(Effect.sync(() => {
  const root = consumer();
  try {
    const context = queryContext(root, ['trace', 'gaps']);
    const requestedAt = Date.now() - 100;
    storeQuery(context, candidate('obsolete', requestedAt - 1000));
    const result = spawnSync(process.execPath, [...workerEntryArgv('query-refresh-worker'), root, JSON.stringify(context.query), String(requestedAt)], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, 0, result.stderr);
    const refreshed = readQuery(context);
    assert.ok(refreshed.record && refreshed.record.scannedAt >= requestedAt, JSON.stringify(refreshed));
    assert.notDeepEqual(refreshed.record.value, gaps('obsolete'));
  } finally { rmSync(root, { recursive: true, force: true }); }
})));


// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
test('packed C2 retains the consistent generation and annotates the later drifting attempt', async () => {
  const root = packedConsumer();
  let stop: (() => Promise<void>) | undefined;
  try {
    const context = { privateDir: genericPrivateDirectorySync(root), query: ['trace', 'gaps'] as const };
    assert.equal((await refreshInstalled(root, ['trace', 'gaps'])).status, 0);
    const previous = packedEnvelope(root, context.query).record;
    assert.ok(previous?.consistent);
    stop = await editing(root, 'docs/feature/sample/README.md');
    assert.equal((await refreshInstalled(root, ['trace', 'gaps'])).status, 0);
    const retained = packedEnvelope(root, context.query);
    assert.deepEqual(retained.record, previous);
    assert.equal(retained.lastAttempt?.complete, false);
    // Atomic replacement can interrupt a read before a structured candidate
    // exists; the adopted drift contract then records an unknown range ('..').
    assert.ok(retained.lastAttempt?.changedPaths.includes('docs/feature/sample/README.md')
      || retained.lastAttempt?.changedPaths.includes("."), JSON.stringify(retained.lastAttempt));
    assert.equal(retained.error, undefined);
    const result = installedCall(root, 'trace', 'gaps');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /此后的刷新在编辑中未能取得一致结果/u);
  } finally { if (stop) await stop(); await waitForRefreshExit(root); rmSync(root, { recursive: true, force: true }); }
});


// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
test('diagnostic refresh accepts absent configuration and binds its later appearance', async () => {
  const root = createConsumer();
  try {
    assert.equal(existsSync(join(root, 'concord.config.ts')), false);
    const missing = queryContext(root, ['trace', 'gaps']);
    await runApplication(refreshQuery(root, missing.query, Date.now()).pipe(Effect.scoped));
    const refreshed = readQuery(missing);
    assert.equal(refreshed.record?.complete, true, JSON.stringify(refreshed));
    assert.equal(refreshed.error, undefined);
    writeProjectConfig(root, { testRoots: [], sourceRoots: [] });
    assert.notEqual(queryContext(root, missing.query).key, missing.key);
    rmSync(join(root, 'concord.config.ts'));
    assert.equal(queryContext(root, missing.query).key, missing.key);
  } finally { await waitForRefreshExit(root); rmSync(root, { recursive: true, force: true }); }
});
