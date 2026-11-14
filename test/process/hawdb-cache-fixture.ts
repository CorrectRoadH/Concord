import { initialize } from '../support/operations.ts';
import { runApplication } from '../support/repository.ts';
import { installedConcordCli } from '../support/support.ts';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync, truncateSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { join } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { cacheStatus, clearCache, scanAnnotations } from "../../src/domain/tests/index.ts";
import { acquireHawdbClearGuard, hawdbIdentity, openHawdb, PersistentCache } from "../../src/base/cache/index.ts";
import { getWorkspaceSnapshot } from "../../src/app/index.ts";
import { deleteInspectedCache, inspectCacheClear } from "../../src/base/cache/index.ts";
import { LocalRepository } from "../support/repository.ts";

import { ensureGenericPrivateDirectorySync } from "../../src/base/publication/index.ts";

const CacheReport = Schema.Struct({ status: Schema.String });
const ScanReport = Schema.Struct({ cache: CacheReport, codeCache: CacheReport });

async function freshConsumer(): Promise<string> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'concord-fresh-cache-')));
  execFileSync('git', ['init', '-q', root]);
  const repo = (await LocalRepository.open(root, { initialize: true }));
  try { (await initialize(repo, false, { testRoots: ['test'], sourceRoots: ['src'] })); }
  finally { repo.close(); }
  // A fresh clone carries these source owners, but none of init's Git-private state.
  rmSync(join(root, '.git/concord'), { recursive: true, force: true });
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/example.ts'), 'export const example = true;\n');
  assert.equal(existsSync(join(root, '.git/concord')), false);
  return root;
}

function cli(root: string, ...args: string[]) {
  return spawnSync(process.execPath, [installedConcordCli(), '--root', root, '--server=command', '--json', ...args], { encoding: 'utf8', timeout: 30_000 });
}

function cacheDiskSnapshot(path: string) {
  const files = [path, ...readdirSync(path, { recursive: true }).map(name => join(path, String(name))), `${path}.concord.lock`];
  return files.sort().map(file => {
    const stat = statSync(file, { bigint: true });
    return { file, ino: stat.ino, modified: stat.mtimeNs, hash: stat.isFile() ? createHash('sha256').update(readFileSync(file)).digest('hex') : null };
  });
}
export { initialize, runApplication, assert, execFileSync, spawnSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync, truncateSync, tmpdir, join, test, Effect, Schema, cacheStatus, clearCache, scanAnnotations, acquireHawdbClearGuard, hawdbIdentity, openHawdb, PersistentCache, getWorkspaceSnapshot, deleteInspectedCache, inspectCacheClear, LocalRepository, ensureGenericPrivateDirectorySync, CacheReport, ScanReport, freshConsumer, cli, cacheDiskSnapshot };
