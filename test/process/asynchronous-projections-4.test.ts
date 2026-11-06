import { makeOwnedProcessService, installationResources, installationRootForBin, classifyQueryRefresh, persist, pathToFileURL, sourceCli, createConsumer, genericPrivateDirectorySync, refreshQuery, pollUntil, decodeDocumentSource, workerEntryArgv, installedConcordCli, assert, execFileSync, spawn, spawnSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, tmpdir, join, resolve, test, before, after, Effect, Schema, sourceRoot, prepareSourceConsumer, cacheDatabasePath, openHawdb, readProjectConfig, writeProjectConfig, LocalRepository, initialize, setAuthor, createDocument, renderDocument, ConcordError, digest, QueryCacheEnvelope, queryContext, readQuery, storeQuery, type Query, gaps, candidate, consumer, cli, call, historicalCall, waitForRefreshExit, packageScratch, installedCli, installedCall, packedConsumer, packedEnvelope, refreshInstalled, editing } from '../support/asynchronous-projections-fixture.ts';
// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
test('CLI exits before refresh, serves a historical snapshot, and keeps fresh checks authoritative', async () => {
  const root = consumer();
  mkdirSync(join(root, 'src'));
  for (let i = 0; i < 1072; i++) writeFileSync(join(root, 'src', `${i}.ts`), `export const value${i} = ${i};\n`);
  try {
    const cold = call(root, 'trace', 'gaps');
    assert.equal(cold.status, 1, cold.stderr);
    assert.match(cold.stderr, /QueryPending/);
    const deadline = Date.now() + 125_000;
    let cached = await packedEnvelope(root, ['trace', 'gaps']);
    while (!cached.record && Date.now() < deadline) {
      await Effect.runPromise(Effect.sleep('100 millis'));
      cached = await packedEnvelope(root, ['trace', 'gaps']);
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
    let failed = await packedEnvelope(root, ['trace', 'gaps']);
    while (!failed.error && Date.now() < failedDeadline) {
      await Effect.runPromise(Effect.sleep('100 millis'));
      failed = await packedEnvelope(root, ['trace', 'gaps']);
    }
    assert.ok(failed.error, JSON.stringify(failed));
    assert.deepEqual(failed.record?.value, cached.record.value, 'failed refresh retains the complete prior diagnostic content');
    writeFileSync(path, source);
  } finally { await waitForRefreshExit(root); rmSync(root, { recursive: true, force: true }); }
});
