import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { Effect } from 'effect';
import { FrozenBrowserRepository } from '../support/browser-shared-fixture.ts';
import { tmpdir } from '../support/temporary.ts';

// @feature docs/engineering/testing/architecture.md#浏览器与诊断
test('frozen browser worktree recovers changed, deleted and added files without following symlinks or replacing Git state', () => Effect.runPromise(Effect.sync(() => {
  const fixture = new FrozenBrowserRepository();
  const outside = mkdtempSync(join(tmpdir(), 'concord-browser-outside-'));
  try {
    const original = readFileSync(join(fixture.root, 'docs/taste.md'));
    const sentinel = join(outside, 'sentinel');
    writeFileSync(sentinel, 'outside remains untouched');
    writeFileSync(join(fixture.root, 'docs/taste.md'), 'changed');
    rmSync(join(fixture.root, 'docs/architecture.md'));
    writeFileSync(join(fixture.root, 'extra.md'), 'added');
    writeFileSync(join(fixture.root, '.git', 'fixture-sentinel'), 'live private state');
    rmSync(join(fixture.root, 'memory'), { recursive: true, force: true });
    symlinkSync(outside, join(fixture.root, 'memory'));
    symlinkSync(outside, join(fixture.root, 'outside'));
    fixture.restore();
    assert.deepEqual(readFileSync(join(fixture.root, 'docs/taste.md')), original);
    assert.equal(readFileSync(sentinel, 'utf8'), 'outside remains untouched');
    assert.equal(readFileSync(join(fixture.root, '.git/fixture-sentinel'), 'utf8'), 'live private state');
    assert.equal(execFileSync('git', ['-C', fixture.root, 'status', '--porcelain'], { encoding: 'utf8' }), '');
    assert.equal(execFileSync('git', ['-C', fixture.root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), fixture.commit);
  } finally { fixture.close(); rmSync(outside, { recursive: true, force: true }); }
})));
