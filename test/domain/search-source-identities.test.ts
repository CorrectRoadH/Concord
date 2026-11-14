import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createConsumer } from '../support/consumer.ts';
import { LocalRepository } from '../support/repository.ts';

// @use-case docs/feature/local-data-engine/use-case/query-current-projections.md
test('search source identities retain Darwin normalized spelling collision rejection', async t => {
  if (process.platform !== 'darwin') { t.skip('Darwin spelling guard'); return; }
  const root = await createConsumer();
  try {
    writeFileSync(join(root, 'memory/ff.md'), '# Plain\n');
    writeFileSync(join(root, 'memory/ｆｆ.md'), '# Fullwidth\n');
    const names = readdirSync(join(root, 'memory'));
    if (!names.includes('ff.md') || !names.includes('ｆｆ.md')) { t.skip('Filesystem aliases the two compatibility spellings'); return; }
    const repo = await LocalRepository.open(root, { access: 'read', persistentCache: 'off' });
    try { assert.throws(() => repo.snapshot(() => repo.fileIdentities('memory')), { code: 'UnsafePath' }); }
    finally { repo.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/local-data-engine/use-case/query-current-projections.md
test('search source identities read changed bytes and reject a changed file before return', async () => {
  const root = await createConsumer();
  writeFileSync(join(root, 'memory/search.md'), 'before');
  const repo = await LocalRepository.open(root, { access: 'read', persistentCache: 'off' });
  try {
    assert.throws(() => repo.fileIdentities('memory'), { code: 'InvalidSourceSnapshot' });
    const identity = repo.snapshot(() => {
      const file = repo.fileIdentities('memory').find(file => file.path === 'memory/search.md')!;
      assert.equal(repo.readIdentified(file.path, file.identity), 'before');
      return file.identity;
    });
    repo.snapshot(() => assert.equal(repo.fileIdentities('memory').find(file => file.path === 'memory/search.md')!.identity, identity));
    assert.throws(() => repo.snapshot(() => {
      repo.fileIdentities('memory');
      writeFileSync(join(root, 'memory/search.md'), 'after!');
    }), { code: 'SourceChanged' });
    repo.snapshot(() => {
      const file = repo.fileIdentities('memory').find(file => file.path === 'memory/search.md')!;
      assert.notEqual(file.identity, identity);
      assert.equal(repo.readIdentified(file.path, file.identity), 'after!');
    });
  } finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/local-data-engine/use-case/query-current-projections.md
test('search source identities reject new nested members and rediscover them on retry', async () => {
  const root = await createConsumer();
  mkdirSync(join(root, 'memory/nested'));
  const repo = await LocalRepository.open(root, { access: 'read', persistentCache: 'off' });
  try {
    assert.throws(() => repo.snapshot(() => {
      repo.fileIdentities('memory');
      writeFileSync(join(root, 'memory/nested/created.md'), 'new');
    }), { code: 'SourceChanged' });
    repo.snapshot(() => assert.ok(repo.fileIdentities('memory').some(file => file.path === 'memory/nested/created.md')));
    assert.throws(() => repo.snapshot(() => {
      repo.fileIdentities('memory');
      renameSync(join(root, 'memory/nested'), join(root, 'memory/moved'));
    }), { code: 'SourceChanged' });
  } finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/local-data-engine/use-case/query-current-projections.md
test('search source identities observe absent roots and reject a replaced path anchor', async () => {
  const root = await createConsumer();
  rmSync(join(root, 'docs/issues'), { recursive: true, force: true });
  const repo = await LocalRepository.open(root, { access: 'read', persistentCache: 'off' });
  try {
    assert.throws(() => repo.snapshot(() => {
      assert.deepEqual(repo.fileIdentities('docs/issues'), []);
      mkdirSync(join(root, 'docs/issues'));
      writeFileSync(join(root, 'docs/issues/new.md'), 'new');
    }), { code: 'SourceChanged' });
    assert.throws(() => repo.snapshot(() => {
      repo.fileIdentities('docs/issues');
      renameSync(join(root, 'docs/issues'), join(root, 'docs/moved-issues'));
      symlinkSync(join(root, 'docs/moved-issues'), join(root, 'docs/issues'));
    }), { code: 'SourceChanged' });
    assert.throws(() => repo.snapshot(() => repo.fileIdentities('docs/issues')), { code: 'UnsafePath' });
  } finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
});
