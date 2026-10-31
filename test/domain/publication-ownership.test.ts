import assert from 'node:assert/strict';
import fs, { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { acquireTraceLeaseSync, releaseTraceLeaseSync, recoverPublicationLeaseSync, tracePrivateDirectorySync, type FileLease } from '../../src/base/publication/index.js';
import { LocalRepository, runApplication } from '../support/repository.js';
import { fixture } from '../support/publication-ownership-fixture.js';


// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('repository construction releases ownership; snapshots and commits use one short lease', t => {
  const root = fixture(t);
  const a = new LocalRepository(root), b = new LocalRepository(root);
  try {
    a.snapshot(() => assert.throws(() => b.snapshot(() => b.read('concord.config.ts')), { code: 'RepositoryBusy' }));
    b.snapshot(() => assert.ok(b.read('concord.config.ts')));
    a.publish('independent', [{ path: 'memory/one.md', before: null, after: 'one' }]);
    b.publish('independent', [{ path: 'memory/two.md', before: null, after: 'two' }]);
    assert.deepEqual(readdirSync(tracePrivateDirectorySync(root)), ['publication.revision']);
  } finally { a.close(); b.close(); }
});


// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('publication rejects changed read dependencies, missing reads and directory membership', t => {
  const root = fixture(t);
  for (const kind of ['bytes', 'absent', 'directory']) {
    const dependency = join(root, `memory/${kind}-dependency.md`);
    if (kind === 'bytes') writeFileSync(dependency, 'before');
    const repo = new LocalRepository(root);
    try {
      repo.snapshot(() => kind === 'directory' ? repo.files('memory') : repo.read(`memory/${kind}-dependency.md`));
      writeFileSync(dependency, 'changed');
      assert.throws(() => repo.publish('stale', [{ path: `memory/${kind}-target.md`, before: null, after: 'must not appear' }]), { code: 'PreimageChanged' });
      assert.equal(existsSync(join(root, `memory/${kind}-target.md`)), false);
      assert.equal(existsSync(join(root, '.git/concord/journal.json')), false);
    } finally { repo.close(); }
  }
});


// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('unknown lock state and repeated old close preserve a new owner', t => {
  const root = fixture(t);
  const first = acquireTraceLeaseSync(root, 'exclusive', 'first')!;
  releaseTraceLeaseSync(first, 'first');
  const second = acquireTraceLeaseSync(root, 'exclusive', 'second')!;
  releaseTraceLeaseSync(first, 'late-close');
  assert.ok(existsSync(join(second.path, `${second.owner.token}.json`)));
  writeFileSync(join(second.path, 'unknown'), 'preserve');
  assert.throws(() => recoverPublicationLeaseSync(root), /unexpected files/);
  assert.throws(() => releaseTraceLeaseSync(second, 'unknown'), /unexpected files/);
  assert.equal(readFileSync(join(second.path, 'unknown'), 'utf8'), 'preserve');
});


// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
// @name shared-join-directory-replacement
test('reader admission rechecks a replaced directory and writer release tolerates pending readers', t => runApplication(Effect.sync(() => {
  const root = fixture(t);
  for (const writerExitsBeforeValidation of [false, true]) {
    const first = acquireTraceLeaseSync(root, 'shared', 'first-reader')!;
    let writer: FileLease | undefined, joined: FileLease | undefined;
    const originalLink = fs.linkSync;
    let injected = false;
    // Only the filesystem scheduling boundary is intercepted. All ownership
    // transitions and protected checks execute the production implementation.
    fs.linkSync = (source, destination) => {
      if (!injected) {
        injected = true;
        releaseTraceLeaseSync(first, 'last-reader-exits');
        writer = acquireTraceLeaseSync(root, 'exclusive', 'replacement-writer')!;
        originalLink(source, destination);
        if (writerExitsBeforeValidation) releaseTraceLeaseSync(writer, 'writer-exits');
      } else originalLink(source, destination);
    };
    syncBuiltinESMExports();
    try {
      if (writerExitsBeforeValidation) {
        joined = acquireTraceLeaseSync(root, 'shared', 'joining-reader')!;
        assert.throws(() => acquireTraceLeaseSync(root, 'exclusive', 'third-writer'), /busy/);
      } else {
        assert.throws(() => acquireTraceLeaseSync(root, 'shared', 'joining-reader'), /busy/);
        assert.ok(writer);
        assert.deepEqual(readdirSync(writer.path), [`${writer.owner.token}.json`]);
      }
      assert.equal(injected, true);
    } finally {
      fs.linkSync = originalLink; syncBuiltinESMExports();
      if (joined) releaseTraceLeaseSync(joined, 'reader-done');
      if (writer) releaseTraceLeaseSync(writer, 'writer-done');
      releaseTraceLeaseSync(first, 'first-done');
    }
    assert.equal(existsSync(first.path), false);
  }
})));
