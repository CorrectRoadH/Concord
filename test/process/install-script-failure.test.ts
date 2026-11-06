// 跨进程保证：外部程序——真实安装脚本下载或校验失败时保持既有可运行安装，拒绝不确定checksum且不发布候选。
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, readlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { withInstaller } from '../support/install-script-fixture.ts';

// @use-case docs/feature/cross-platform-release/use-case/install-with-script.md
test('download, checksum and archive extraction failures preserve existing version bytes and links', { timeout: 55_000 }, () => withInstaller(f => {
  f.publish('0.9.1'); f.succeed('0.9.1');
  const before = readlinkSync(f.bin), previousManifest = readFileSync(join(f.root, '0.9.1/app/package.json'), 'utf8');
  for (const failure of [{ missing: true }, { corrupt: true }, { brokenArchive: true }]) {
    f.publish('0.9.2', failure); const result = f.install('0.9.2'); assert.notEqual(result.status, 0, JSON.stringify(failure));
    assert.equal(readlinkSync(f.bin), before); assert.equal(readFileSync(join(f.root, '0.9.1/app/package.json'), 'utf8'), previousManifest);
    assert.deepEqual(readdirSync(f.root), ['0.9.1']);
    assert.equal(f.cli(['--version']).status, 0);
  }
  f.publish('0.9.1', { brokenArchive: true }); const result = f.install('0.9.1'); assert.notEqual(result.status, 0);
  assert.equal(readlinkSync(f.bin), before); assert.equal(readFileSync(join(f.root, '0.9.1/app/package.json'), 'utf8'), previousManifest);
  assert.deepEqual(readdirSync(f.root), ['0.9.1']);
}));

// @use-case docs/feature/cross-platform-release/use-case/install-with-script.md
test('a missing or changed installed checksum refuses same-version overwrite without switching or cleaning', () => withInstaller(f => {
  f.publish('0.9.1'); f.succeed('0.9.1'); f.publish('0.9.2'); f.succeed('0.9.2');
  const before = readlinkSync(f.bin), entry = readFileSync(join(f.root, '0.9.1/bin/concord'));
  const marker = join(f.root, '0.9.1/.archive-sha256');
  for (const value of ['0'.repeat(64), undefined]) {
    if (value === undefined) unlinkSync(marker); else writeFileSync(marker, value);
    const result = f.install('0.9.1'); assert.notEqual(result.status, 0); assert.match(result.stderr, /delete .* and retry/);
    assert.equal(readlinkSync(f.bin), before); assert.deepEqual(readFileSync(join(f.root, '0.9.1/bin/concord')), entry);
    assert.deepEqual(readdirSync(f.root).sort(), ['0.9.1', '0.9.2']);
  }
}));

// @use-case docs/feature/cross-platform-release/use-case/install-with-script.md
test('ambiguous or absent basename checksums reject the download before installation writes', () => withInstaller(f => {
  f.publish('0.9.1');
  const sums = join(f.release, 'download/v0.9.1/SHA256SUMS'), original = readFileSync(sums, 'utf8');
  for (const rows of [original + original, original.replace(/concord-0\.9\.1/gu, 'other-0.9.1')]) {
    writeFileSync(sums, rows);
    const result = f.install('0.9.1'); assert.notEqual(result.status, 0); assert.match(result.stderr, /Missing or ambiguous archive checksum/);
    assert.equal(existsSync(f.root), false);
  }
}));
