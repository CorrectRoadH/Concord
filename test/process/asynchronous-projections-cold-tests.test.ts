// 跨进程保证：服务与 IPC——独立测试来源写入进程与后台扫描并行时，冷投影保留不完整状态与漂移路径。
import { makeOwnedProcessService, installationResources, installationRootForBin, classifyQueryRefresh, persist, pathToFileURL, sourceCli, createConsumer, genericPrivateDirectorySync, refreshQuery, pollUntil, decodeDocumentSource, workerEntryArgv, installedConcordCli, assert, execFileSync, spawn, spawnSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, tmpdir, join, resolve, test, before, after, Effect, Schema, sourceRoot, prepareSourceConsumer, cacheDatabasePath, openHawdb, readProjectConfig, writeProjectConfig, LocalRepository, initialize, setAuthor, createDocument, renderDocument, ConcordError, digest, QueryCacheEnvelope, queryContext, readQuery, storeQuery, type Query, gaps, candidate, consumer, cli, call, historicalCall, waitForRefreshExit, packageScratch, installedCli, installedCall, packedConsumer, packedEnvelope, refreshInstalled, editing } from '../support/asynchronous-projections-fixture.ts';


// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
test("packed C1 publishes cold projections during continuous docs, test, and code edits during test edits", async () => {
  for (const relative of ['test/000.ts']) {
    const root = packedConsumer();
    let stop: (() => Promise<void>) | undefined;
    const failures: unknown[] = [];
    try {
      stop = await editing(root, relative);
      const result = await refreshInstalled(root, ['trace', 'gaps']);
      assert.equal(result.status, 0, result.stderr);
      const context = { privateDir: genericPrivateDirectorySync(root, process.env), query: ['trace', 'gaps'] as const };
      const stored = await packedEnvelope(root, context.query);
      assert.ok(stored.record, JSON.stringify(stored));
      assert.equal(stored.record.consistent, false);
      assert.equal(stored.record.complete, false);
      assert.equal(stored.record.unknownRelations, true);
      // CodeSourceChanged may report an unknown range ('..'). A successful stable
      // recompilation retains known code relationships even when source drifted.
      assert.ok(stored.record.changedPaths.includes(relative)
        || relative.startsWith('src/') && stored.record.changedPaths.includes("."), JSON.stringify(stored));
      const shown = installedCall(root, '--json', 'trace', 'gaps');
      assert.equal(shown.status, 0, shown.stderr);
      assert.equal(JSON.parse(shown.stdout).projection.consistent, false);
      const human = installedCall(root, 'trace', 'gaps');
      assert.equal(human.status, 0, human.stderr);
      assert.match(human.stdout, /关系可能不完整/u);
    } catch (cause) { failures.push(cause); } finally {
      const cleanup: unknown[] = [];
      try { if (stop) await stop(); } catch (cause) { cleanup.push(cause); }
      try { await waitForRefreshExit(root); } catch (cause) { cleanup.push(cause); }
      failures.push(...cleanup);
      if (cleanup.length === 0) {
        try { rmSync(root, { recursive: true, force: true }); } catch (cause) { failures.push(cause); }
      }
    }
    if (failures.length) throw new AggregateError(failures, `Cold diagnostic fixture failed; root: ${root}`);
  }
});
