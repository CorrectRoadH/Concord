import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { Effect } from 'effect';
import { NodeFileSystem } from '@effect/platform-node';
import { prepareConfigMigration, applyConfigMigration } from '../scripts/migrate-config.js';
import { parseTypeScriptConfig } from '../src/config.js';

function fixture(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), 'concord-config-migration-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', root]);
  writeFileSync(join(root, 'concord.json'), JSON.stringify({ format: 'concord.project/v1', projectId: 'migration', testRoots: [], runner: { kind: 'node-test', sourceFiles: [], timeoutMs: 60000 }, feedbackConnections: [{ id: 'github', provider: 'github', owner: 'example', repo: 'project', credentialEnv: 'TOKEN_NAME_ONLY' }] }));
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']);
  return root;
}

test('offline config conversion preserves values, removes JSON, and checks exact repeats', async t => {
  const root = fixture(t);
  const plan = await Effect.runPromise(prepareConfigMigration(root).pipe(Effect.provide(NodeFileSystem.layer)));
  const run = () => Effect.runPromise(applyConfigMigration(plan).pipe(Effect.provide(NodeFileSystem.layer)));
  assert.equal((await run()).status, 'applied');
  assert.equal(existsSync(join(root, 'concord.json')), false);
  assert.deepEqual(parseTypeScriptConfig(readFileSync(join(root, 'concord.config.ts'), 'utf8')), JSON.parse(plan.before));
  assert.equal((await run()).status, 'already-applied');
  writeFileSync(join(root, 'concord.config.ts'), plan.after + '\n// external edit\n');
  await assert.rejects(run(), /Configuration changed since planning/);
});

test('config migration rejects drift, arbitrary planned output, and dual owners before writing', async t => {
  const root = fixture(t);
  const plan = await Effect.runPromise(prepareConfigMigration(root).pipe(Effect.provide(NodeFileSystem.layer)));
  await assert.rejects(Effect.runPromise(applyConfigMigration({ ...plan, after: plan.after.replace('60000', '60001') }).pipe(Effect.provide(NodeFileSystem.layer))), /preserve the exact decoded JSON values/);
  assert.equal(existsSync(join(root, 'concord.config.ts')), false);
  writeFileSync(join(root, 'concord.json'), plan.before + '\n');
  await assert.rejects(Effect.runPromise(applyConfigMigration(plan).pipe(Effect.provide(NodeFileSystem.layer))), /Configuration changed since planning/);
  assert.equal(readFileSync(join(root, 'concord.json'), 'utf8'), plan.before + '\n');
  writeFileSync(join(root, 'concord.config.ts'), plan.after);
  await assert.rejects(Effect.runPromise(prepareConfigMigration(root).pipe(Effect.provide(NodeFileSystem.layer))), /Preserve both configuration files/);
});

test('historical journals reject migration without creating or changing locks', async t => {
  for (const presentLock of [false, true]) {
    const root = fixture(t);
    mkdirSync(join(root, '.git/concord'));
    const journal = join(root, '.git/concord/journal.json');
    const deadlock = join(root, '.git/concord/lock.json');
    writeFileSync(journal, '{"format":"concord.journal","scope":{"kind":"documents"}}');
    writeFileSync(deadlock, '{"pid":99999999}');
    const lock = join(root, '.git/niceeval/docs-trace/publication.lock');
    if (presentLock) {
      mkdirSync(join(root, '.git/niceeval/docs-trace'), { recursive: true });
      writeFileSync(lock, 'existing lock bytes');
      chmodSync(lock, 0o644);
    }
    await assert.rejects(Effect.runPromise(prepareConfigMigration(root).pipe(Effect.provide(NodeFileSystem.layer))), /independent, explicit offline recovery/);
    assert.equal(readFileSync(journal, 'utf8'), '{"format":"concord.journal","scope":{"kind":"documents"}}');
    assert.equal(readFileSync(deadlock, 'utf8'), '{"pid":99999999}');
    assert.equal(existsSync(lock), presentLock);
    if (presentLock) {
      assert.equal(statSync(lock).mode & 0o777, 0o644);
      assert.equal(readFileSync(lock, 'utf8'), 'existing lock bytes');
    }
    assert.equal(existsSync(join(root, 'concord.config.ts')), false);
  }
});
