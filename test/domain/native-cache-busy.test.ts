import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { openHawdb } from '../../src/base/cache/index.ts';
import { collectNativeTests } from '../../src/domain/tests/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { LocalRepository, runApplication } from '../support/repository.ts';
import { readProjectConfig, writeProjectConfig } from '../support/support.ts';

// @feature docs/feature/local-data-engine/architecture.md#本地操作的缓存快照
test('native collection fails before execution on real cache contention', { skip: process.platform !== 'linux' && 'Successful collection requires safe directory-handle report traversal, verified only on Linux' }, async () => {
  const root = (await createConsumer());
  let repo: LocalRepository | undefined;
  try {
    const source = fileURLToPath(new URL('../..', import.meta.url));
    mkdirSync(join(root, 'test'));
    writeFileSync(join(root, 'test/sample.ts'), '// @feature docs/feature/local-sdlc/README.md\n// @name cache-contention\n');
    writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
    symlinkSync(join(source, 'node_modules'), join(root, 'node_modules'), 'dir');
    writeFileSync(join(root, 'adapter.ts'), readFileSync(join(source, 'test/fixtures/process-adapter.ts'), 'utf8'));
    writeFileSync(join(root, 'mode.txt'), 'green');
    writeProjectConfig(root, { ...(await readProjectConfig(root)), testRoots: ['test'], testAdapters: [{ id: 'fixture', include: ['test'], argv: [process.execPath, 'adapter.ts'], implementationFiles: ['adapter.ts'], inputRoots: [], lockFiles: [], frameworkVersion: 'fixture/v1', envNames: ['PATH'] }] });
    repo = (await LocalRepository.open(root));
    const held = openHawdb(join(repo.privateDir, 'cache.hawdb'), { create: true, readOnly: false }, makeRuntimeEnvironment(root, process.env));
    try {
      await assert.rejects(runApplication(collectNativeTests(repo, ['test/sample.ts'])), error => {
        assert.equal((error as { code: string }).code, 'HawdbBusy');
        return true;
      });
    } finally { held.close(); }
  } finally { repo?.close(); rmSync(root, { recursive: true, force: true }); }
});
