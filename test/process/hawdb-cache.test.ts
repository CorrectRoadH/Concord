// 跨进程保证：原生模块与句柄——native清理guard保持owner inode并拒绝检查后引入的外链、替换与新成员。
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { initialize, runApplication, installedConcordCli, assert, createHash, execFileSync, spawnSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync, truncateSync, tmpdir, join, resolve, test, Effect, Schema, cacheStatus, clearCache, scanAnnotations, acquireHawdbClearGuard, hawdbIdentity, openHawdb, PersistentCache, getWorkspaceSnapshot, deleteInspectedCache, inspectCacheClear, LocalRepository, ensureGenericPrivateDirectorySync, CacheReport, ScanReport, freshConsumer, cli, cacheDiskSnapshot } from './hawdb-cache-fixture.ts';

const nativeRuntime = makeRuntimeEnvironment(process.cwd(), process.env);


// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('fresh dry-run and cache-off processes never touch an existing complete cache', () => runApplication(Effect.sync(() => {
  const root = freshConsumer();
  try {
    const rebuilt = cli(root, 'cache', 'rebuild');
    assert.equal(rebuilt.status, 0, rebuilt.stdout + rebuilt.stderr);
    const shown = cli(root, '--dry-run', 'config', 'show');
    assert.equal(shown.status, 0, shown.stderr);
    const config = JSON.parse(shown.stdout) as { config: { sourceRoots: string[] }; digest: string };
    const input = join(root, 'config-preview.json');
    writeFileSync(input, JSON.stringify({ ...config.config, sourceRoots: [...config.config.sourceRoots, 'extra-src'] }));
    const path = join(root, '.git/concord/cache.hawdb');
    const before = cacheDiskSnapshot(path);
    for (const args of [['check'], ['docs', 'check'], ['writing', 'check'], ['cache', 'status'], ['cache', 'clear'], ['feedback', 'list'], ['config', 'set', '--input', input, '--if-unchanged', config.digest]]) {
      const result = cli(root, '--dry-run', ...args);
      assert.equal(result.signal, null, result.stdout + result.stderr);
      assert.ok(result.status === 0 || result.status === 1, result.stdout + result.stderr);
      assert.doesNotThrow(() => JSON.parse(result.stdout), result.stdout + result.stderr);
      if (args[0] === 'cache' && args[1] === 'status') {
        assert.equal(JSON.parse(result.stdout).status, 'unavailable');
        assert.match(JSON.parse(result.stdout).detail, /access is disabled/u);
      }
      assert.deepEqual(cacheDiskSnapshot(path), before, args.join(' '));
    }
    for (const mode of ['workspace', 'config-preview', 'feedback']) {
      const result = spawnSync(process.execPath, ['test/support/cache-off-probe.ts', root, mode], { cwd: process.cwd(), encoding: 'utf8', timeout: 30_000 });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.deepEqual(cacheDiskSnapshot(path), before, mode);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
})));


// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('clear unlinks internal aliases before native locks and can retry after detected mutations', () => {
  for (const mutation of ['none', 'external-link', 'replace', 'new-member']) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'concord-clear-links-')));
    const path = join(root, 'cache.hawdb');
    mkdirSync(join(path, 'left'), { recursive: true }); mkdirSync(join(path, 'right'));
    const data = join(path, 'left/data'); const alias = join(path, 'right/alias');
    const nestedLock = join(path, 'right/owner.hawdb.lock'); const outside = join(root, 'outside');
    writeFileSync(data, 'retained bytes'); linkSync(data, alias); writeFileSync(nestedLock, '');
    const guard = acquireHawdbClearGuard(path, nativeRuntime);
    const rootInode = statSync(path).ino; const lockInode = statSync(join(path, 'owner.hawdb.lock')).ino;
    const siblingInode = statSync(`${path}.concord.lock`).ino;
    try {
      let verifications = 0;
      const run = () => deleteInspectedCache(inspectCacheClear(root), () => {
        guard.verify();
        if (++verifications === 2) {
          if (mutation === 'external-link') linkSync(data, outside);
          if (mutation === 'replace') { renameSync(data, outside); writeFileSync(data, 'replacement'); }
          if (mutation === 'new-member') writeFileSync(join(path, 'introduced'), 'new content');
        }
        if (!existsSync(nestedLock)) assert.ok(!existsSync(data) && !existsSync(alias), 'non-lock data must be deleted before any native lock');
      });
      if (mutation === 'none') run();
      else {
        assert.throws(run, { code: 'UnsafePath' });
        if (existsSync(outside)) { assert.equal(readFileSync(outside, 'utf8'), 'retained bytes'); rmSync(outside); }
        deleteInspectedCache(inspectCacheClear(root), guard.verify);
      }
      assert.deepEqual(readdirSync(path), ['owner.hawdb.lock']);
      assert.equal(statSync(path).ino, rootInode);
      assert.equal(statSync(join(path, 'owner.hawdb.lock')).ino, lockInode);
      assert.equal(statSync(`${path}.concord.lock`).ino, siblingInode);
    } finally { guard.close(); rmSync(root, { recursive: true, force: true }); }
  }
});
