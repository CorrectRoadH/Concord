// 跨进程保证：原生模块与句柄——维护worker在publication争用时释放native锁并延后删除，后续回收保留持久owner inode。
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { initialize } from '../support/operations.ts';
import { workerEntryArgv, CACHE_MAINTENANCE_THRESHOLD_BYTES } from "../../src/base/installation/index.ts";
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { LocalRepository } from "../support/repository.ts";

import { openHawdb } from "../../src/base/cache/index.ts";

const nativeRuntime = makeRuntimeEnvironment(process.cwd(), process.env);

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'concord-maintenance-')));
  execFileSync('git', ['init', '-q', root]);
  const repo = new LocalRepository(root, { initialize: true });
  try { initialize(repo, false, { testRoots: [], sourceRoots: [] }); } finally { repo.close(); }
  const path = join(root, '.git/concord/cache.hawdb');
  const db = openHawdb(path, { readOnly: false, create: true }, nativeRuntime);
  db.put('config_cache', [{ key: 'retained', payload: 'a current logical value' }]); db.close();
  return { root, path, privateDir: join(root, '.git/concord'), padding: join(path, 'retained-padding') };
}
function pad(path: string, bytes: number) { writeFileSync(path, ''); truncateSync(path, bytes); }
function worker(root: string) {
  const result = spawnSync(process.execPath, [...workerEntryArgv('cache-maintenance-worker'), root], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
const read = (path: string) => {
  const db = openHawdb(path, { readOnly: true, create: false }, nativeRuntime);
  try { return db.get('config_cache', ['retained', 'concurrent-writer']); } finally { db.close(); }
};

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('the maintenance worker reclaims without discarding an arbitrarily large cache', () => Effect.runPromise(Effect.sync(() => {
  const f = fixture();
  try {
    pad(f.padding, CACHE_MAINTENANCE_THRESHOLD_BYTES + 1);
    worker(f.root);
    assert.equal(existsSync(f.padding), true, 'reclamation admission does not imply discard');
    assert.equal(read(f.path)[0]?.payload, 'a current logical value');
    pad(f.padding, CACHE_MAINTENANCE_THRESHOLD_BYTES * 2 + 1);
    const owner = statSync(join(f.path, 'owner.hawdb.lock')).ino;
    const external = statSync(`${f.path}.concord.lock`).ino;
    worker(f.root);
    assert.equal(existsSync(f.padding), true);
    assert.equal(read(f.path)[0]?.payload, 'a current logical value');
    assert.equal(statSync(join(f.path, 'owner.hawdb.lock')).ino, owner);
    assert.equal(statSync(`${f.path}.concord.lock`).ino, external);

  } finally { rmSync(f.root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
test('publication contention does not make reclamation discard logical data', () => Effect.runPromise(Effect.sync(() => {
  const f = fixture();
  const publisher = new LocalRepository(f.root);
  try {
    pad(f.padding, CACHE_MAINTENANCE_THRESHOLD_BYTES * 2 + 1);
    publisher.beginSnapshot();
    worker(f.root);
    assert.equal(existsSync(f.padding), true);
    assert.equal(read(f.path)[0]?.payload, 'a current logical value', 'native locks are released even while publication is occupied');
    publisher.endSnapshot();
    worker(f.root);
    assert.equal(existsSync(f.padding), true);
    assert.equal(read(f.path)[0]?.payload, 'a current logical value');
  } finally { publisher.close(); rmSync(f.root, { recursive: true, force: true }); }
})));

