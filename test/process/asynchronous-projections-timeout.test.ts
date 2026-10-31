import { runApplication } from '../support/repository.js';
import { makeOwnedProcessService, installationResources, installationRootForBin, classifyQueryRefresh, persist, pathToFileURL, packageBin, createConsumer, genericPrivateDirectorySync, refreshQuery, pollUntil, decodeDocumentSource, workerEntryArgv, installedConcordCli, assert, execFileSync, spawn, spawnSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, tmpdir, join, resolve, test, before, after, Effect, Schema, packConcord, installConcord, cacheDatabasePath, openHawdb, readProjectConfig, writeProjectConfig, LocalRepository, initialize, setAuthor, createDocument, renderDocument, ConcordError, digest, QueryCacheEnvelope, queryContext, readQuery, storeQuery, type Query, gaps, candidate, consumer, cli, call, historicalCall, waitForRefreshExit, packageScratch, installedCli, installedCall, packedConsumer, packedEnvelope, refreshInstalled, editing } from '../support/asynchronous-projections-fixture.js';


// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
test('C3 internal short deadline preserves timeout details with and without a generation', async () => {
  for (const warm of [false, true]) {
    const root = packedConsumer();
    try {
      const context = queryContext(root, ['trace', 'gaps']);
      if (warm) await runApplication(refreshQuery(root, ['trace', 'gaps'], Date.now()).pipe(Effect.scoped));
      const previous = readQuery(context).record;
      const scannedAt = Date.now(), started = performance.now();
      const result = await runApplication(makeOwnedProcessService().run([process.execPath, '--import', import.meta.resolve('tsx'), '--import', pathToFileURL(resolve('test/fixtures/stall-process.ts')).href,
        installationResources(installationRootForBin(installedCli)).worker('query-scan-worker'), root, JSON.stringify(['trace', 'gaps'])],
        { cwd: root, timeoutMs: 100, outputLimitBytes: 4 * 1024 * 1024 }).pipe(Effect.scoped));
      const update = classifyQueryRefresh(context.key, queryContext(root, ['trace', 'gaps']).key, result, scannedAt, performance.now() - started, 100);
      if (update.kind === 'identity-changed') assert.fail('Fixture installation changed during the stopped scan');
      await runApplication(persist(context, update));
      const timedOut = readQuery(context);
      assert.equal(timedOut.error?.code, 'QueryRefreshTimedOut', JSON.stringify(timedOut));
      assert.equal(timedOut.error.limitMs, 100);
      assert.ok(timedOut.error.elapsedMs! >= 100);
      assert.deepEqual(timedOut.record, previous);
    } finally { await waitForRefreshExit(root); rmSync(root, { recursive: true, force: true }); }
  }
});
