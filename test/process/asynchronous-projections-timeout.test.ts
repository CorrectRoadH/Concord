// 跨进程保证：进程终止与信号——真实scan子进程超时后返回deadline详情并保持先前已发布generation。
import { runApplication } from '../support/repository.ts';
import { makeOwnedProcessService, installationResources, installationRootForBin, classifyQueryRefresh, persist, pathToFileURL, sourceCli, createConsumer, genericPrivateDirectorySync, refreshQuery, pollUntil, decodeDocumentSource, workerEntryArgv, installedConcordCli, assert, execFileSync, spawn, spawnSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, tmpdir, join, resolve, test, before, after, Effect, Schema, sourceRoot, prepareSourceConsumer, cacheDatabasePath, openHawdb, readProjectConfig, writeProjectConfig, LocalRepository, initialize, setAuthor, createDocument, renderDocument, ConcordError, digest, QueryCacheEnvelope, queryContext, readQuery, storeQuery, type Query, gaps, candidate, consumer, cli, call, historicalCall, waitForRefreshExit, packageScratch, installedCli, installedCall, packedConsumer, packedEnvelope, refreshInstalled, editing } from '../support/asynchronous-projections-fixture.ts';


// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
test('C3 internal short deadline preserves timeout details with and without a generation', async () => {
  for (const warm of [false, true]) {
    const root = packedConsumer();
    try {
      const context = (await queryContext(root, ['trace', 'gaps']));
      if (warm) await runApplication(refreshQuery(root, ['trace', 'gaps'], Date.now()).pipe(Effect.scoped));
      const previous = readQuery(context).record;
      const scannedAt = Date.now(), started = performance.now();
      const result = await runApplication(makeOwnedProcessService().run([process.execPath, '--import', pathToFileURL(resolve('test/fixtures/stall-process.ts')).href,
        installationResources(installationRootForBin(installedCli)).worker('query-scan-worker'), root, JSON.stringify(['trace', 'gaps'])],
        { cwd: root, timeoutMs: 100, outputLimitBytes: 4 * 1024 * 1024 }).pipe(Effect.scoped));
      const update = classifyQueryRefresh(context.key, (await queryContext(root, ['trace', 'gaps'])).key, result, scannedAt, performance.now() - started, 100);
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
