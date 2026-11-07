// 跨进程保证：原生模块与句柄——native写入进程被SIGKILL后的WAL恢复保留已提交数据并维护ownership inode。
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { initialize, runApplication, installedConcordCli, assert, createHash, execFileSync, spawnSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync, truncateSync, tmpdir, join, resolve, test, Effect, Schema, cacheStatus, clearCache, scanAnnotations, acquireHawdbClearGuard, hawdbIdentity, openHawdb, PersistentCache, getWorkspaceSnapshot, deleteInspectedCache, inspectCacheClear, LocalRepository, ensureGenericPrivateDirectorySync, CacheReport, ScanReport, freshConsumer, cli, cacheDiskSnapshot } from './hawdb-cache-fixture.ts';

const nativeRuntime = makeRuntimeEnvironment(process.cwd(), process.env);


// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('cache initialization refuses symlinked private directories and directories outside Git', () => runApplication(Effect.tryPromise(async () => {
  const root = (await freshConsumer());
  const outside = mkdtempSync(join(tmpdir(), 'concord-cache-outside-'));
  try {
    assert.throws(() => ensureGenericPrivateDirectorySync(root, outside, process.env), /inside the selected Git directory/u);
    const link = join(root, '.git/concord');
    symlinkSync(outside, link);
    assert.throws(() => ensureGenericPrivateDirectorySync(root, link, process.env), /symbolic links/u);
    for (const args of [['check'], ['cache', 'rebuild'], ['cache', 'status'], ['--dry-run', 'cache', 'clear']]) {
      const result = cli(root, ...args);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /symlink|symbolic links/u);
      assert.equal(existsSync(join(outside, 'cache.hawdb')), false);
    }
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
})));


// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('cache-enabled workspace recovers an interrupted WAL without clearing committed cache entries', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-cache-wal-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    const repo = (await LocalRepository.open(root, { initialize: true }));
    const path = join(repo.privateDir, 'cache.hawdb');
    try { (await initialize(repo, false, { testRoots: [] })); PersistentCache.repository(repo).prepareWrite({ create: true }); (await scanAnnotations(repo)); } finally { repo.close(); }
    const child = spawnSync(process.execPath, ['test/fixtures/hawdb-interrupted.ts', path], { encoding: 'utf8', timeout: 15000 });
    assert.equal(child.signal, 'SIGKILL', child.stderr);
    const interrupted = cacheDiskSnapshot(path);
    await runApplication(getWorkspaceSnapshot(root, 'off'));
    assert.deepEqual(cacheDiskSnapshot(path), interrupted, 'cache-off must not touch the interrupted database');
    const readOnly = openHawdb(path, { readOnly: true, create: false }, nativeRuntime);
    try { assert.deepEqual(readOnly.get('config_cache', ['interrupted']), [{ key: 'interrupted', payload: 'committed' }]); }
    finally { readOnly.close(); }
    const snapshot = await runApplication(getWorkspaceSnapshot(root, 'use'));
    assert.equal(snapshot.complete, true);
    const recovered = openHawdb(path, { readOnly: true, create: false }, nativeRuntime);
    try { assert.deepEqual(recovered.get('config_cache', ['interrupted']), [{ key: 'interrupted', payload: 'committed' }]); }
    finally { recovered.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});


// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
// @name oversized-cache-remains-recoverable
test('large cache directories remain readable and clearable without deleting the ownership inode', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-large-cache-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    const repo = (await LocalRepository.open(root, { initialize: true }));
    try {
      (await initialize(repo));
      PersistentCache.repository(repo).prepareWrite({ create: true });
      assert.equal((await scanAnnotations(repo)).cache.status, 'miss');
      const path = join(repo.privateDir, 'cache.hawdb');
      const inode = statSync(join(path, 'owner.hawdb.lock')).ino;
      const large = join(path, 'old-segment');
      writeFileSync(large, '');
      truncateSync(large, 257 * 1024 * 1024);
      for (let index = 0; index < 4100; index++) writeFileSync(join(path, `old-${index}`), '');
      assert.equal((await scanAnnotations(repo)).cache.status, 'hit');
      assert.notEqual(cacheStatus(repo, nativeRuntime).status, 'unavailable');
      assert.equal(clearCache(repo, undefined, nativeRuntime).status, 'cleared');
      assert.equal(statSync(join(path, 'owner.hawdb.lock')).ino, inode);
      PersistentCache.repository(repo).prepareWrite({ create: true });
      assert.equal((await scanAnnotations(repo)).cache.status, 'miss');
      assert.equal((await scanAnnotations(repo)).cache.status, 'hit');
    } finally { repo.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});


// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('clear keeps the HawDB lock inode and removes only HawDB cache data', async () => {
  assert.equal(hawdbIdentity(nativeRuntime).engine, 'hawdb');
  const root = mkdtempSync(join(tmpdir(), 'concord-hawdb-clear-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    const initial = (await LocalRepository.open(root, { initialize: true }));
    try { (await initialize(initial)); } finally { initial.close(); }
    const repo = (await LocalRepository.open(root));
    try {
      const path = join(repo.privateDir, 'cache.hawdb');
      assert.equal(cacheStatus(repo, nativeRuntime).status, 'empty');
      assert.equal(existsSync(path), false);
      PersistentCache.repository(repo).prepareWrite({ create: true });
      assert.equal((await scanAnnotations(repo)).cache.status, 'miss');
      const lock = join(path, 'owner.hawdb.lock');
      const inode = statSync(lock).ino;
      const unrelated = join(repo.privateDir, 'unrelated-data');
      writeFileSync(unrelated, 'preserve these bytes');
      assert.equal(clearCache(repo, undefined, nativeRuntime).status, 'cleared');
      assert.equal(existsSync(unrelated), true);
      assert.equal(statSync(lock).ino, inode);
      assert.equal(cacheStatus(repo, nativeRuntime).status, 'empty');
      assert.equal(clearCache(repo, undefined, nativeRuntime).status, 'empty');
      assert.equal(statSync(lock).ino, inode);
      const unsafe = join(path, 'unexpected-link');
      symlinkSync(join(repo.privateDir, 'absent'), unsafe);
      assert.throws(() => clearCache(repo, undefined, nativeRuntime), /Unsupported cache entry|UnsafePath/u);
      assert.equal(statSync(lock).ino, inode);
      rmSync(unsafe);
    } finally { repo.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});


// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('clear rejects an ownership inode replacement and a link introduced after inspection', () => {
  for (const mutation of ['owner', 'link']) {
    const root = mkdtempSync(join(tmpdir(), 'concord-clear-race-'));
    const path = join(root, 'cache.hawdb');
    const guard = acquireHawdbClearGuard(path, nativeRuntime);
    try {
      const sentinel = join(root, 'sentinel');
      writeFileSync(sentinel, 'keep');
      const inventory = inspectCacheClear(root);
      if (mutation === 'owner') {
        renameSync(join(path, 'owner.hawdb.lock'), join(root, 'old-owner'));
        writeFileSync(join(path, 'owner.hawdb.lock'), '');
      } else symlinkSync(sentinel, join(path, 'changed'));
      assert.throws(() => deleteInspectedCache(inventory, guard.verify), { code: 'UnsafePath' });
      assert.equal(readFileSync(sentinel, 'utf8'), 'keep');
    } finally { guard.close(); rmSync(root, { recursive: true, force: true }); }
  }
});


// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('failed native close still releases the outer repository lease', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-hawdb-close-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    const initial = (await LocalRepository.open(root, { initialize: true }));
    try { (await initialize(initial)); } finally { initial.close(); }
    const repo = (await LocalRepository.open(root));
    const unsafe = join(repo.privateDir, 'cache.hawdb', 'unexpected-link');
    try {
      (await assert.rejects(async () => (await repo.snapshot(async () => {
        PersistentCache.repository(repo).prepareWrite({ create: true });
        (await scanAnnotations(repo));
        symlinkSync(join(root, 'absent'), unsafe);
      })), /UnsafePath|symlink/u));
      rmSync(unsafe);
      const reopened = (await LocalRepository.open(root));
      try { assert.equal((await scanAnnotations(reopened)).cache.status, 'hit'); }
      finally { reopened.close(); }
    } finally { repo.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});


// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('identity mismatch is unavailable for reads and the next writable rebuild discards and recreates under the same owner lock', () => runApplication(Effect.tryPromise(async () => {
  const root = (await freshConsumer());
  try {
    const directory = join(root, '.git/concord');
    mkdirSync(directory, { recursive: true });
    execFileSync('tar', ['-xzf', resolve('test/fixtures/hawdb/v0.3.0-cache.tar.gz'), '-C', directory]);
    const path = join(directory, 'cache.hawdb');
    const inode = statSync(join(path, 'owner.hawdb.lock')).ino;
    const manifest = readFileSync(join(path, 'manifest.hawdb'));
    const status = cli(root, 'cache', 'status');
    assert.equal(status.status, 0, status.stdout + status.stderr);
    assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(CacheReport), { onExcessProperty: 'ignore' })(status.stdout).status, 'unavailable');
    assert.deepEqual(readFileSync(join(path, 'manifest.hawdb')), manifest);
    const scan = cli(root, 'cache', 'rebuild');
    assert.equal(scan.status, 0, scan.stdout + scan.stderr);
    const current = openHawdb(path, { readOnly: true, create: false }, nativeRuntime);
    try {
      assert.equal(current.scan('config_cache').some(entry => entry.key === 'legacy-config'), false);
      assert.deepEqual(current.scan('feedback_cache'), []);
    }
    finally { current.close(); }
    assert.equal(statSync(join(path, 'owner.hawdb.lock')).ino, inode);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));
