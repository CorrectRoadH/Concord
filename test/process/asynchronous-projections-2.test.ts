import { makeOwnedProcessService, installationResources, installationRootForBin, classifyQueryRefresh, persist, pathToFileURL, packageBin, createConsumer, genericPrivateDirectorySync, refreshQuery, pollUntil, decodeDocumentSource, workerEntryArgv, installedConcordCli, assert, execFileSync, spawn, spawnSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, tmpdir, join, resolve, test, before, after, Effect, Schema, packConcord, installConcord, cacheDatabasePath, openHawdb, readProjectConfig, writeProjectConfig, LocalRepository, initialize, setAuthor, createDocument, renderDocument, ConcordError, digest, QueryCacheEnvelope, queryContext, readQuery, storeQuery, type Query, gaps, candidate, consumer, cli, call, historicalCall, waitForRefreshExit, packageScratch, installedCli, installedCall, packedConsumer, packedEnvelope, refreshInstalled, editing } from '../support/asynchronous-projections-fixture.js';


// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
test('packed C1 publishes cold projections during continuous docs, test, and code edits', async () => {
  for (const relative of ['docs/feature/sample/README.md', 'test/000.ts', 'src/000.ts']) {
    const root = packedConsumer();
    let stop: (() => Promise<void>) | undefined;
    try {
      stop = await editing(root, relative);
      const result = await refreshInstalled(root, ['trace', 'gaps']);
      assert.equal(result.status, 0, result.stderr);
      const context = { privateDir: genericPrivateDirectorySync(root), query: ['trace', 'gaps'] as const };
      const stored = packedEnvelope(root, context.query);
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
    } finally { if (stop) await stop(); await waitForRefreshExit(root); rmSync(root, { recursive: true, force: true }); }
  }
});
