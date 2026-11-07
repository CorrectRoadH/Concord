import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Effect, Sink, Stdio } from 'effect';
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { openHawdb } from '../../src/base/cache/index.ts';
import { collectNativeTests, runCase, scanAnnotations } from '../../src/domain/tests/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { LocalRepository, runApplication } from '../support/repository.ts';
import { readProjectConfig, writeProjectConfig } from '../support/support.ts';

// @feature docs/feature/local-data-engine/architecture.md#本地操作的缓存快照
test('native execution keeps its result on cache contention while discovery reports CacheUpdateFailed', async () => {
  const root = createConsumer();
  let repo: LocalRepository | undefined;
  try {
    const source = fileURLToPath(new URL('../..', import.meta.url));
    mkdirSync(join(root, 'test'));
    writeFileSync(join(root, 'test/sample.ts'), '// @feature docs/feature/local-sdlc/README.md\n// @name cache-contention\n');
    writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
    symlinkSync(join(source, 'node_modules'), join(root, 'node_modules'), 'dir');
    writeFileSync(join(root, 'adapter.ts'), readFileSync(join(source, 'test/fixtures/process-adapter.ts'), 'utf8'));
    writeFileSync(join(root, 'mode.txt'), 'green');
    writeProjectConfig(root, { ...readProjectConfig(root), testRoots: ['test'], testAdapters: [{ id: 'fixture', include: ['test'], argv: [process.execPath, 'adapter.ts'], implementationFiles: ['adapter.ts'], inputRoots: [], lockFiles: [], frameworkVersion: 'fixture/v1', envNames: ['PATH'] }] });
    repo = new LocalRepository(root);
    const selected = scanAnnotations(repo, { cache: 'off' }).cases[0]!;
    const held = openHawdb(join(repo.privateDir, 'cache.hawdb'), { create: true, readOnly: false }, makeRuntimeEnvironment(root, process.env));
    try {
      const warnings: string[] = [];
      const current = repo;
      const result = await runApplication(Effect.gen(function*() {
        const stdio = yield* Stdio.Stdio;
        return yield* runCase(current, selected, [], { requireNative: true }).pipe(Effect.provideService(Stdio.Stdio, { ...stdio, stderr: () => Sink.forEach((chunk: string | Uint8Array) => Effect.sync(() => { warnings.push(Buffer.from(chunk).toString('utf8')); })) }));
      }));
      assert.equal(result.scope, 'native');
      assert.equal(result.commandOutcome, 'green');
      assert.equal(JSON.parse(warnings.join('')).warning, 'CacheUpdateFailed');
      assert.match(warnings.join(''), /HawdbBusy/u);
      await assert.rejects(runApplication(collectNativeTests(repo, ['test/sample.ts'])), error => {
        assert.equal((error as { code: string }).code, 'CacheUpdateFailed');
        assert.match(JSON.stringify((error as { details: unknown }).details), /HawdbBusy/u);
        return true;
      });
    } finally { held.close(); }
  } finally { repo?.close(); rmSync(root, { recursive: true, force: true }); }
});
