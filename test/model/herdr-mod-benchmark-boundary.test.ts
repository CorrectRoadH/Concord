import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { ModSession, ModFailure, type ModHost } from '../../src/entry/herdr-mod/index.ts';
import { digest } from '../../src/model/index.ts';
import { documentBodies, featurePath } from '../../bench/support/herdr-mod.ts';

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

