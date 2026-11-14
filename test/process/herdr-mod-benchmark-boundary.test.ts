import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import test from 'node:test';
import { Effect, Exit, Schema, Scope } from 'effect';
import { ModSession, ModFailure, type ModHost } from '../../src/entry/herdr-mod/index.ts';
import { digest } from '../../src/model/index.ts';
import { documentBodies, featurePath, modRepositoryFixture } from '../../bench/support/herdr-mod.ts';

const Input = Schema.Struct({ action: Schema.String, path: Schema.String, body: Schema.optional(Schema.String) });

// @feature docs/feature/herdr-mod/README.md
test('save confirmation waits for the actual session readback and excludes background check', async () => {
  const readback = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const calls: string[] = [];
  let body: string = documentBodies[0];
  let reads = 0;
  const host: ModHost = { async exec(command, args) {
    assert.equal(command, 'concord');
    assert.equal(args[args.indexOf('--root') + 2], 'action', 'no whole-repository check enters confirmation');
    const input = Schema.decodeUnknownSync(Schema.fromJsonString(Input), { onExcessProperty: 'ignore' })(
      args.filter(arg => arg.startsWith('--input-text=')).map(arg => arg.slice('--input-text='.length)).join(''),
    );
    calls.push(input.action);
    assert.equal(input.path, featurePath);
    if (input.action === 'document.set') {
      body = input.body!;
      return { code: 0, stdout: JSON.stringify({ changedPaths: [featurePath] }), stderr: '' };
    }
    assert.equal(input.action, 'file.get');
    if (++reads === 2) { started.resolve(); await readback.promise; }
    return { code: 0, stdout: JSON.stringify({ path: featurePath, body, digest: digest(body) }), stderr: '' };
  } };
  const session = new ModSession(host, '/private-consumer');
  // Only the selected page is arranged; save, decoding, CAS and acceptance use product code.
  session.selected = featurePath;
  const saved = Effect.runPromise(session.save(documentBodies[1]));
  try {
    await Promise.race([started.promise, saved.then(() => { throw new Error('Save completed without reaching readback'); })]);
    assert.equal(session.saving, true);
    assert.notEqual(session.source, documentBodies[1]);
  } finally { readback.resolve(); }
  try {
    await saved;
    assert.equal(session.saving, false);
    assert.equal(session.source, documentBodies[1]);
    assert.equal(session.draft, undefined);
    await Effect.runPromise(session.save(documentBodies[0]));
    assert.equal(session.source, documentBodies[0]);
    assert.deepEqual(calls, ['file.get', 'document.set', 'file.get', 'file.get', 'document.set', 'file.get']);
  } finally { session.stop(); }
});

// @feature docs/feature/herdr-mod/README.md
test('save confirmation propagates CLI failure and releases saving', async () => {
  const session = new ModSession({ exec: async () => ({
    code: 1, stdout: '', stderr: JSON.stringify({ error: 'BenchmarkBoundaryFailure', message: 'read failed' }),
  }) }, '/private-consumer');
  session.selected = featurePath;
  try {
    const result = await Effect.runPromise(Effect.result(session.save(documentBodies[1])));
    assert.equal(result._tag, 'Failure');
    if (result._tag === 'Failure') {
      assert.ok(result.failure instanceof ModFailure);
      assert.equal(result.failure.code, 'BenchmarkBoundaryFailure');
    }
    assert.equal(session.saving, false);
  } finally { session.stop(); }
});

// @feature docs/feature/herdr-mod/README.md
test('benchmark consumers use real CLI sessions and release both private services', { timeout: 120_000 }, async () => {
  const scope = await Effect.runPromise(Scope.make());
  let directory: string | undefined;
  try {
    const fixture = await modRepositoryFixture(scope);
    directory = dirname(fixture.roots[0]);
    const sessions = fixture.roots.map(root => new ModSession(fixture.host, root));
    try {
      for (const session of sessions) {
        await Effect.runPromise(session.refresh());
        assert.ok(session.loaded && session.initialized);
        assert.ok(session.documents.some(document => document.path === featurePath));
        assert.ok(existsSync(`${session.root}/.git/concord/server/current.json`));
      }
      const session = sessions[0]!;
      const calls: string[][] = [];
      const observed = new ModSession({ exec: (command, args, options) => {
        calls.push(args);
        return fixture.host.exec(command, args, options);
      } }, session.root);
      try {
        await Effect.runPromise(observed.open(featurePath));
        assert.equal(observed.source, documentBodies[0]);
        for (const body of [documentBodies[1], documentBodies[0]]) {
          await Effect.runPromise(observed.save(body));
          assert.equal(observed.source, body);
          assert.equal(observed.saving, false);
          assert.equal(observed.draft, undefined);
        }
        assert.ok(calls.every(args => args[args.indexOf('--root') + 2] !== 'check'));
      } finally { observed.stop(); }
    } finally { for (const session of sessions) session.stop(); }
    // Outer-scope cleanup also covers generators whose sampling body throws before resuming.
  } finally { await Effect.runPromise(Scope.close(scope, Exit.void)); }
  assert.ok(directory);
  assert.equal(existsSync(directory), false, 'both server stops finish before private repositories are removed');
});
