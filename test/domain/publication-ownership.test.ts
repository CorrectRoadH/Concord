import assert from 'node:assert/strict';
import fs, { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { syncBuiltinMocks as syncBuiltinESMExports } from '../support/builtin-mocks.ts';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { acquireTraceLeaseSync, releaseTraceLeaseSync, recoverPublicationLeaseSync, tracePrivateDirectorySync, type FileLease } from '../../src/base/publication/index.ts';
import { LocalRepository, runApplication } from '../support/repository.ts';
import { fixture } from '../support/publication-ownership-fixture.ts';


// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('repository construction releases ownership; snapshots and commits use one short lease', async t => {
  const root = (await fixture(t));
  const a = (await LocalRepository.open(root)), b = (await LocalRepository.open(root));
  try {
    a.snapshot(() => assert.throws(() => b.snapshot(() => b.read('concord.config.ts')), { code: 'RepositoryBusy' }));
    b.snapshot(() => assert.ok(b.read('concord.config.ts')));
    (await a.publish('independent', [{ path: 'memory/one.md', before: null, after: 'one' }]));
    (await b.publish('independent', [{ path: 'memory/two.md', before: null, after: 'two' }]));
    assert.deepEqual(readdirSync(tracePrivateDirectorySync(root, process.env)), []);
  } finally { a.close(); b.close(); }
});


// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('publication rejects changed read dependencies, missing reads and directory membership', async t => {
  const root = (await fixture(t));
  for (const kind of ['bytes', 'absent', 'directory']) {
    const dependency = join(root, `memory/${kind}-dependency.md`);
    if (kind === 'bytes') writeFileSync(dependency, 'before');
    const repo = (await LocalRepository.open(root));
    try {
      repo.snapshot(() => kind === 'directory' ? repo.files('memory') : repo.read(`memory/${kind}-dependency.md`));
      writeFileSync(dependency, 'changed');
      (await assert.rejects(async () => (await repo.publish('stale', [{ path: `memory/${kind}-target.md`, before: null, after: 'must not appear' }])), { code: 'FileChangedSinceRead' }));
      assert.equal(existsSync(join(root, `memory/${kind}-target.md`)), false);
      assert.equal(existsSync(join(root, '.git/concord/journal.json')), false);
    } finally { repo.close(); }
  }
});


// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('unknown lock state and repeated old close preserve a new owner', async t => {
  const root = (await fixture(t));
  const first = acquireTraceLeaseSync(root, 'exclusive', 'first', undefined, undefined, process.env)!;
  releaseTraceLeaseSync(first, 'first');
  const second = acquireTraceLeaseSync(root, 'exclusive', 'second', undefined, undefined, process.env)!;
  releaseTraceLeaseSync(first, 'late-close');
  assert.ok(existsSync(join(second.path, `${second.owner.token}.json`)));
  writeFileSync(join(second.path, 'unknown'), 'preserve');
  assert.throws(() => recoverPublicationLeaseSync(root, process.env), /unexpected files/);
  assert.throws(() => releaseTraceLeaseSync(second, 'unknown'), /unexpected files/);
  assert.equal(readFileSync(join(second.path, 'unknown'), 'utf8'), 'preserve');
});


// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
// @name shared-join-directory-replacement
test('reader admission rechecks a replaced directory and writer release tolerates pending readers', t => runApplication(Effect.tryPromise(async () => {
  const root = (await fixture(t));
  for (const writerExitsBeforeValidation of [false, true]) {
    const first = acquireTraceLeaseSync(root, 'shared', 'first-reader', undefined, undefined, process.env)!;
    let writer: FileLease | undefined, joined: FileLease | undefined;
    const originalLink = fs.linkSync;
    let injected = false;
    // Only the filesystem scheduling boundary is intercepted. All ownership
    // transitions and protected checks execute the production implementation.
    fs.linkSync = (source, destination) => {
      if (!injected) {
        injected = true;
        releaseTraceLeaseSync(first, 'last-reader-exits');
        writer = acquireTraceLeaseSync(root, 'exclusive', 'replacement-writer', undefined, undefined, process.env)!;
        originalLink(source, destination);
        if (writerExitsBeforeValidation) releaseTraceLeaseSync(writer, 'writer-exits');
      } else originalLink(source, destination);
    };
    syncBuiltinESMExports();
    try {
      if (writerExitsBeforeValidation) {
        joined = acquireTraceLeaseSync(root, 'shared', 'joining-reader', undefined, undefined, process.env)!;
        assert.throws(() => acquireTraceLeaseSync(root, 'exclusive', 'third-writer', undefined, undefined, process.env), /busy/);
      } else {
        assert.throws(() => acquireTraceLeaseSync(root, 'shared', 'joining-reader', undefined, undefined, process.env), /busy/);
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
