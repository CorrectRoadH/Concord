// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#清理
import { basename, join } from 'node:path';
import { acquireFileLock, type FileLock } from '../file-lock/index.ts';
import type { RuntimeEnvironmentSnapshot } from '../environment/index.ts';
import { assertCacheDatabaseSafe, inspectCacheTree } from './cache-file.ts';
import { HawdbFailure } from './hawdb-types.ts';
import { acquireHawdbOwnerGate, hawdbFailure } from './hawdb-native.ts';

/** With the official handle closed, lock the complete engine inventory. */
export function acquireHawdbClearGuard(path: string, _runtime?: RuntimeEnvironmentSnapshot, borrowedGate?: FileLock) {
  const locks: FileLock[] = [];
  let closed = false;
  let gate: FileLock | undefined;
  try {
    gate = borrowedGate ?? acquireHawdbOwnerGate(path);
    if (!assertCacheDatabaseSafe(path)) throw new HawdbFailure('HawdbUnavailable', 'Cache directory is absent');
    // Root ownership is required before creating a missing catalog lock.
    locks.push(acquireFileLock(join(path, 'owner.hawdb.lock')));
    let tree = inspectCacheTree(path);
    const branches = join(path, 'branches');
    if (tree.has(branches)) locks.push(acquireFileLock(join(branches, 'metadata.hawdb.lock')));
    tree = inspectCacheTree(path);
    const expected = new Map([...tree].filter(([name, entry]) => entry.directory || basename(name).endsWith('.lock')));
    const verify = () => {
      try {
      if (closed) throw new HawdbFailure('HawdbClosed', 'Clear guard is closed');
      gate!.verify();
      for (const lock of locks) lock.verify();
      const current = inspectCacheTree(path);
      // Data can be removed by this guard; directory and lock identities cannot change.
      for (const [name, entry] of current) {
        if (!entry.directory && !basename(name).endsWith('.lock')) continue;
        const prior = expected.get(name);
        if (!prior || prior.dev !== entry.dev || prior.ino !== entry.ino || prior.directory !== entry.directory) throw new HawdbFailure('UnsafePath', `Cache ownership inventory changed: ${name}`);
      }
      for (const [name, entry] of expected) if (!entry.directory && !current.has(name)) throw new HawdbFailure('UnsafePath', `Cache lock disappeared: ${name}`);
      } catch (cause) { throw hawdbFailure(cause); }
    };
    for (const [name, entry] of expected) {
      if (entry.directory || name === join(path, 'owner.hawdb.lock') || name === join(branches, 'metadata.hawdb.lock')) continue;
      locks.push(acquireFileLock(name, false));
      verify();
    }
    verify();
    const final = inspectCacheTree(path);
    if (final.size !== tree.size || [...tree].some(([name, entry]) => { const after = final.get(name); return !after || after.dev !== entry.dev || after.ino !== entry.ino || after.bytes !== entry.bytes || after.links !== entry.links; })) throw new HawdbFailure('UnsafePath', 'Cache changed while acquiring clear locks');
    return { verify, close: () => {
      if (closed) return;
      closed = true;
      for (const lock of [...locks].reverse()) lock.close();
      if (!borrowedGate) gate!.close();
    } };
  } catch (cause) {
    for (const lock of [...locks].reverse()) lock.close();
    if (!borrowedGate) gate?.close();
    throw hawdbFailure(cause);
  }
}
