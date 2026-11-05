import { makeOwnedProcessService, installationResources, installationRootForBin, classifyQueryRefresh, persist, pathToFileURL, packageBin, createConsumer, genericPrivateDirectorySync, refreshQuery, pollUntil, decodeDocumentSource, workerEntryArgv, installedConcordCli, assert, execFileSync, spawn, spawnSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, tmpdir, join, resolve, test, before, after, Effect, Schema, sourceConcord, prepareSourceConsumer, cacheDatabasePath, openHawdb, readProjectConfig, writeProjectConfig, LocalRepository, initialize, setAuthor, createDocument, renderDocument, ConcordError, digest, QueryCacheEnvelope, queryContext, readQuery, storeQuery, type Query, gaps, candidate, consumer, cli, call, historicalCall, waitForRefreshExit, packageScratch, installedCli, installedCall, packedConsumer, packedEnvelope, refreshInstalled, editing } from '../support/asynchronous-projections-fixture.js';
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
    let cached = packedEnvelope(root, ['trace', 'gaps']);
    while (!cached.record && Date.now() < deadline) {
      await Effect.runPromise(Effect.sleep('100 millis'));
      cached = packedEnvelope(root, ['trace', 'gaps']);
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
    let failed = packedEnvelope(root, ['trace', 'gaps']);
    while (!failed.error && Date.now() < failedDeadline) {
      await Effect.runPromise(Effect.sleep('100 millis'));
      failed = packedEnvelope(root, ['trace', 'gaps']);
    }
    assert.ok(failed.error, JSON.stringify(failed));
    assert.deepEqual(failed.record?.value, cached.record.value, 'failed refresh retains the complete prior diagnostic content');
    writeFileSync(path, source);
  } finally { await waitForRefreshExit(root); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/local-sdlc/use-case/discover-annotated-tests.md
test('packed CLI discovers real sources without reading environment files or following environment links', async () => {
  const root = packedConsumer(false);
  try {
    writeProjectConfig(root, { ...readProjectConfig(root), sourceIgnore: ['src/vendor', 'test/vendor'] });
    for (const base of ['src', 'test']) {
      mkdirSync(join(root, base, 'vendor'));
      writeFileSync(join(root, base, 'vendor/invalid.ts'), '// @feature docs/feature/absent/README.md\n');
      symlinkSync(root, join(root, base, 'vendor/cycle'));
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
