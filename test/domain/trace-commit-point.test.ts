import { withPublication } from '../support/repository.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs, { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { syncBuiltinMocks as syncBuiltinESMExports } from '../support/builtin-mocks.ts';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { mutateTraceFiles, recoverTrace, tracePrivateDirectorySync } from '../../src/base/publication/index.ts';
import { fixture } from '../support/publication-ownership-fixture.ts';

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('durable committed phase alone decides whether an interrupted complete pair finishes or rolls back', async t => {
  for (const committed of [false, true]) {
    const root = (await fixture(t));
    execFileSync('git', ['-C', root, 'add', 'concord.config.ts']);
    execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']);
    for (const name of ['a', 'b']) writeFileSync(join(root, `${name}.md`), `old-${name}`);
    await assert.rejects(Effect.runPromise(withPublication(mutateTraceFiles({ root, operation: 'replace-pair',
      changes: [{ path: 'a.md', bytes: 'new-a' }, { path: 'b.md', bytes: 'new-b' }],
      ...(committed ? { injectFailureAfterCommit: true } : { injectFailureAfterRename: 2 }),
    }))), /injected interruption/);
    const path = join(tracePrivateDirectorySync(root, process.env), 'multi-file-publication-journal.json');
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).phase, committed ? 'committed' : 'publishing');
    assert.equal(readFileSync(join(root, 'a.md'), 'utf8'), 'new-a');
    assert.equal(readFileSync(join(root, 'b.md'), 'utf8'), 'new-b');
    assert.equal((await Effect.runPromise(withPublication(recoverTrace(root)))).action, committed ? 'completed' : 'rolled-back');
    for (const name of ['a', 'b']) assert.equal(readFileSync(join(root, `${name}.md`), 'utf8'), `${committed ? 'new' : 'old'}-${name}`);
    assert.equal(existsSync(path), false);
  }
});

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('the first cleanup failure after commit is recovered under the same lease and returns a success receipt', async t => {
  const root = (await fixture(t));
  execFileSync('git', ['-C', root, 'add', 'concord.config.ts']);
  execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']);
  const path = join(tracePrivateDirectorySync(root, process.env), 'multi-file-publication-journal.json');
  const original = fs.rmSync;
  let attempts = 0;
  fs.rmSync = (target, options) => {
    if (String(target) === path && ++attempts === 1) throw new Error('Injected cleanup I/O failure');
    original(target, options);
  };
  syncBuiltinESMExports();
  try {
    const receipt = await Effect.runPromise(withPublication(mutateTraceFiles({ root, operation: 'commit-cleanup', changes: [{ path: 'a.md', bytes: 'committed' }] })));
    assert.equal(receipt.committed, true);
    assert.equal(readFileSync(join(root, 'a.md'), 'utf8'), 'committed');
    assert.equal(existsSync(path), false);
    assert.equal(attempts, 2);
  } finally { fs.rmSync = original; syncBuiltinESMExports(); }
});
