import assert from 'node:assert/strict';
import { linkSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { cachePhysicalBytes } from '../../src/base/cache/index.ts';
import { cacheStatus } from '../../src/domain/tests/index.ts';
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { LocalRepository } from '../support/repository.ts';
import { tmpdir } from '../support/temporary.ts';

// @feature docs/feature/local-data-engine/cli.md#缓存状态
test('physical status counts internal hard links once and refuses external links', () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-physical-'));
  const path = join(root, 'cache.hawdb');
  try {
    mkdirSync(path);
    writeFileSync(join(path, 'one'), '1234567890');
    linkSync(join(path, 'one'), join(path, 'two'));
    assert.equal(cachePhysicalBytes(root), 10);
    linkSync(join(path, 'one'), join(root, 'outside'));
    assert.throws(() => cachePhysicalBytes(root), { code: 'UnsafePath' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/feature/local-data-engine/cli.md#缓存状态
test('cache status reports physical bytes without an automatic maintenance threshold', async () => {
  const root = await createConsumer();
  let repo: LocalRepository | undefined;
  try {
    repo = await LocalRepository.open(root, { access: 'read' });
    const report = cacheStatus(repo, makeRuntimeEnvironment(root, process.env));
    assert.equal(report.physicalBytes, cachePhysicalBytes(repo.privateDir));
    assert.equal('reclaimThresholdBytes' in report, false);
    assert.equal('physicalLimitBytes' in report, false);
  } finally { repo?.close(); rmSync(root, { recursive: true, force: true }); }
});
