import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createConsumer } from '../support/consumer.ts';
import { LocalRepository } from '../support/repository.ts';
import { writeProjectConfig } from '../support/support.ts';

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('asynchronous snapshots retain ownership and verify bytes after the callback settles', async () => {
  const root = await createConsumer();
  writeProjectConfig(root, { testRoots: [], sourceRoots: [] });
  const repo = await LocalRepository.open(root, { access: 'read' });
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  try {
    const pending = repo.snapshot(async () => {
      const before = repo.read('concord.config.ts');
      assert.ok(before);
      await waiting;
      assert.equal(repo.read('concord.config.ts'), before);
    });
    assert.throws(() => repo.snapshot(() => undefined), { code: 'RepositoryBusy' });
    release();
    await pending;
    const original = repo.read('concord.config.ts')!;
    await assert.rejects(repo.snapshot(async () => {
      const before = repo.read('concord.config.ts')!;
      await Promise.resolve();
      writeFileSync(join(root, 'concord.config.ts'), `${before}\n// changed during await\n`);
    }), { code: 'SourceChanged' });
    writeFileSync(join(root, 'concord.config.ts'), original);
    // A failed verification releases the owner so a later independent scope can run.
    assert.doesNotThrow(() => repo.snapshot(() => repo.read('concord.config.ts')));
  } finally {
    release();
    repo.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('source publication rejects configuration changed while asynchronous authorization is pending', async () => {
  const root = await createConsumer();
  writeProjectConfig(root, { testRoots: [], sourceRoots: ['src'] });
  mkdirSync(join(root, 'src'));
  const before = 'export const value = 1;\n';
  writeFileSync(join(root, 'src/sample.ts'), before);
  const repo = await LocalRepository.open(root);
  try {
    const pending = repo.publishSource('src/sample.ts', before, 'export const value = 2;\n');
    writeProjectConfig(root, { testRoots: [], sourceRoots: ['other'] });
    await assert.rejects(pending, { code: 'FileChangedSinceRead' });
    assert.equal(readFileSync(join(root, 'src/sample.ts'), 'utf8'), before);
    assert.equal(existsSync(join(root, '.git/concord/journal.json')), false);
  } finally {
    repo.close();
    rmSync(root, { recursive: true, force: true });
  }
});
