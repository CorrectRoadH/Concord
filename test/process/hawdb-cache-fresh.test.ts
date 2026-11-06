import { initialize, runApplication, installedConcordCli, assert, createHash, execFileSync, spawnSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync, truncateSync, tmpdir, join, resolve, test, Effect, Schema, cacheStatus, clearCache, scanAnnotations, acquireHawdbClearGuard, hawdbIdentity, openHawdb, PersistentCache, getWorkspaceSnapshot, deleteInspectedCache, inspectCacheClear, LocalRepository, ensureGenericPrivateDirectorySync, CacheReport, ScanReport, freshConsumer, cli, cacheDiskSnapshot } from './hawdb-cache-fixture.ts';


// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('fresh Git consumers start a cache owner for checks and explicit rebuild keeps persistent hits available', () => runApplication(Effect.sync(() => {
  const root = freshConsumer();
  try {
    const cold = cli(root, 'check');
    const first = Schema.decodeUnknownSync(Schema.fromJsonString(ScanReport))(cold.stdout);
    assert.ok(['hit', 'miss'].includes(first.cache.status), cold.stdout + cold.stderr);
    assert.ok(['hit', 'miss'].includes(first.codeCache.status));
    const directory = join(root, '.git/concord');
    assert.equal(existsSync(join(directory, 'cache.hawdb')), true);
    const rebuilt = cli(root, 'cache', 'rebuild');
    assert.equal(rebuilt.status, 0, rebuilt.stdout + rebuilt.stderr);
    assert.equal(statSync(directory).mode & 0o777, 0o700);
    assert.equal(existsSync(join(directory, 'cache.hawdb/owner.hawdb.lock')), true);
    const warm = cli(root, 'check');
    const second = Schema.decodeUnknownSync(Schema.fromJsonString(ScanReport))(warm.stdout);
    assert.equal(second.cache.status, 'hit', warm.stdout + warm.stderr);
    assert.equal(second.codeCache.status, 'hit');
    assert.equal(warm.status, cold.status, 'cache does not change the check verdict');
  } finally { rmSync(root, { recursive: true, force: true }); }
})));


// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('fresh cache rebuild produces ready projections and reports busy rebuilds as named failures', () => runApplication(Effect.sync(() => {
  const root = freshConsumer();
  try {
    const rebuilt = cli(root, 'cache', 'rebuild');
    assert.equal(rebuilt.status, 0, rebuilt.stdout + rebuilt.stderr);
    const report = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ cacheStatus: CacheReport })))(rebuilt.stdout);
    assert.equal(report.cacheStatus.status, 'ready');
    const status = cli(root, 'cache', 'status');
    assert.equal(status.status, 0, status.stdout + status.stderr);
    assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(CacheReport))(status.stdout).status, 'ready');
    const database = openHawdb(join(root, '.git/concord/cache.hawdb'), { readOnly: false, create: false });
    try {
      const busy = cli(root, 'cache', 'rebuild');
      assert.equal(busy.status, 1, busy.stdout + busy.stderr);
      const error = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ error: Schema.Literal('CacheRebuildUnavailable') })))(busy.stderr);
      assert.equal(error.error, 'CacheRebuildUnavailable');
    } finally { database.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
})));


// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('fresh status, cache-off checks and dry-run previews leave Git-private state absent', () => runApplication(Effect.sync(() => {
  const root = freshConsumer();
  try {
    for (const args of [['cache', 'status'], ['--dry-run', 'check'], ['--dry-run', 'docs', 'check'], ['--dry-run', 'writing', 'check'], ['--dry-run', 'cache', 'clear'], ['--dry-run', 'cache', 'rebuild']]) {
      const result = cli(root, ...args);
      assert.equal(result.signal, null, result.stdout + result.stderr);
      if (args[0] === 'cache') { assert.equal(result.status, 0); assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(CacheReport))(result.stdout).status, 'empty'); }
      if (args.length === 2 && args.at(-1) === 'check') {
        const report = Schema.decodeUnknownSync(Schema.fromJsonString(ScanReport))(result.stdout);
        assert.equal(report.cache.status, 'off'); assert.equal(report.codeCache.status, 'off');
      }
      if (args.at(-1) === 'clear') assert.equal(result.status, 0, result.stdout + result.stderr);
      if (args.at(-1) === 'rebuild') { assert.equal(result.status, 1); assert.match(result.stderr, /InvalidOption/u); }
      assert.equal(existsSync(join(root, '.git/concord')), false, args.join(' '));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
})));
