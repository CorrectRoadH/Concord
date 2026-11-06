// 跨进程保证：外部程序——真实patchelf重定位物理ELF owner，保留硬链接包存储inode与原字节。
import assert from 'node:assert/strict';
import { chmod, copyFile, link, mkdtemp, readFile, realpath, rm, stat, mkdir, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { NodeServices } from '@effect/platform-node';
import { archiveElfFiles, relocateElf } from '../../scripts/archive-linux.ts';
import { ArchiveFailed, sha256 } from '../../scripts/archive-support.ts';
const toolsAvailable = process.platform === 'linux' && spawnSync('patchelf', ['--version']).status === 0 && spawnSync('readelf', ['--version']).status === 0;

// @feature docs/feature/cross-platform-release/architecture.md#linux-运行库
test('real ELF relocation replaces the archive inode while preserving a hardlinked package store', { skip: process.platform !== 'linux' && 'ELF relocation applies only to Linux' }, async () => {
  if (!toolsAvailable) throw new ArchiveFailed({ message: 'Missing Linux ELF packaging tools: patchelf and readelf must be on PATH' });
  const root = await mkdtemp(join(tmpdir(), 'concord-elf-hardlink-'));
  try {
    const store = join(root, 'store-elf'), archive = join(root, 'archive-elf');
    await copyFile(process.execPath, store);
    await chmod(store, 0o755);
    await link(store, archive);
    const bytes = await readFile(store), before = await stat(store);
    assert.equal((await stat(archive)).ino, before.ino);
    const oldPath = spawnSync('patchelf', ['--print-rpath', store], { encoding: 'utf8' });
    assert.equal(oldPath.status, 0, oldPath.stderr);
    await Effect.runPromise(relocateElf(archive, '$ORIGIN/runtime/lib', true).pipe(Effect.provide(NodeServices.layer)));
    assert.equal(sha256(await readFile(store)), sha256(bytes));
    assert.equal((await stat(store)).ino, before.ino);
    assert.notEqual((await stat(archive)).ino, before.ino);
    assert.notEqual(sha256(await readFile(archive)), sha256(bytes));
    assert.equal((await stat(archive)).mode & 0o777, 0o755);
    assert.equal(spawnSync('patchelf', ['--print-rpath', store], { encoding: 'utf8' }).stdout, oldPath.stdout);
    assert.equal(spawnSync('patchelf', ['--print-rpath', archive], { encoding: 'utf8' }).stdout.trim(), '$ORIGIN/runtime/lib');
  } finally { await rm(root, { recursive: true }); }
});

// @feature docs/feature/cross-platform-release/architecture.md#linux-运行库
test('ELF aliases are relocated and validated relative to the physical owner', { skip: process.platform !== 'linux' && 'ELF relocation applies only to Linux' }, async () => {
  if (!toolsAvailable) throw new ArchiveFailed({ message: 'Missing Linux ELF packaging tools: patchelf and readelf must be on PATH' });
  const root = await mkdtemp(join(tmpdir(), 'concord-elf-alias-'));
  try {
    const physical = join(root, 'app/node_modules/.pnpm/pkg/node_modules/pkg/native.node');
    const alias = join(root, 'a-early-alias.node');
    const libraries = join(root, 'runtime/lib');
    await mkdir(dirname(physical), { recursive: true });
    await mkdir(libraries, { recursive: true });
    await copyFile(process.execPath, physical);
    await chmod(physical, 0o755);
    await symlink(relative(dirname(alias), physical), alias);
    const files = await Effect.runPromise(archiveElfFiles(root).pipe(Effect.provide(NodeServices.layer)));
    assert.deepEqual(files, [await realpath(physical)], 'enumeration must retain physical ELF owners, never the first alias');
    for (const file of files) await Effect.runPromise(relocateElf(file, `$ORIGIN/${relative(dirname(file), libraries)}`, true).pipe(Effect.provide(NodeServices.layer)));
    for (const file of [physical, alias]) {
      const rpath = spawnSync('patchelf', ['--print-rpath', file], { encoding: 'utf8' });
      assert.equal(rpath.status, 0, rpath.stderr);
      assert.equal(resolve(dirname(await realpath(file)), rpath.stdout.trim().replace('$ORIGIN', '.')), libraries);
    }
  } finally { await rm(root, { recursive: true }); }
});
