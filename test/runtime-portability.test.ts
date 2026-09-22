import assert from 'node:assert/strict';
import test from 'node:test';
import { observeOwnedProcessGroup } from '../dist/owned-process.js';
import { assertDarwinPublicationPaths, darwinPathCollisionKey, hasExactDarwinEntry } from '../dist/storage.js';

test('Darwin path guards preserve exact bytes and reject case or Unicode publication aliases', () => {
  assert.equal(hasExactDarwinEntry([Buffer.from('.git')], '.git'), true);
  assert.equal(hasExactDarwinEntry([Buffer.from('.git')], '.GIT'), false);
  assert.equal(hasExactDarwinEntry([Buffer.from('café', 'utf8')], 'cafe\u0301'), false);
  assert.equal(darwinPathCollisionKey('Docs/Café.md'), darwinPathCollisionKey('docs/cafe\u0301.md'));
  assert.throws(
    () => assertDarwinPublicationPaths(['docs/Case/a.md', 'docs/case/b.md'], 'darwin'),
    { code: 'InvalidChange' },
  );
  assert.throws(
    () => assertDarwinPublicationPaths(['docs/Café.md', 'docs/cafe\u0301.md'], 'darwin'),
    { code: 'InvalidChange' },
  );
  assert.doesNotThrow(() => assertDarwinPublicationPaths(['docs/Case/a.md', 'docs/case/b.md'], 'linux'));
});

test('Darwin process-group presence treats only ESRCH as gone', () => {
  assert.equal(observeOwnedProcessGroup(42, { platform: 'darwin', kill: () => undefined }), 'alive');
  assert.equal(observeOwnedProcessGroup(42, { platform: 'darwin', kill: () => { const error = new Error('gone') as NodeJS.ErrnoException; error.code = 'ESRCH'; throw error; } }), 'gone');
  assert.equal(observeOwnedProcessGroup(42, { platform: 'darwin', kill: () => { const error = new Error('denied') as NodeJS.ErrnoException; error.code = 'EPERM'; throw error; } }), 'unknown');
});

test('Linux process-group observation does not turn unreadable proc state into zombie-only', () => {
  const zombie = '1 (worker) Z 0 42 42 0';
  assert.equal(observeOwnedProcessGroup(42, { platform: 'linux', kill: () => undefined, procEntries: () => ['1'], procStat: () => zombie }), 'zombie-only');
  assert.equal(observeOwnedProcessGroup(42, {
    platform: 'linux',
    kill: () => undefined,
    procEntries: () => ['1', '2'],
    procStat: (pid) => {
      if (pid === '1') return zombie;
      const error = new Error('denied') as NodeJS.ErrnoException;
      error.code = 'EACCES';
      throw error;
    },
  }), 'unknown');
  assert.equal(observeOwnedProcessGroup(42, {
    platform: 'linux',
    kill: () => undefined,
    procEntries: () => ['1', '2'],
    procStat: (pid) => {
      if (pid === '1') return zombie;
      const error = new Error('raced') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      throw error;
    },
  }), 'zombie-only');
});
