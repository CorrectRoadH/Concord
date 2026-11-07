import assert from 'node:assert/strict';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema } from 'effect';
import { join } from 'node:path';
import { GateAdmissionPeak, gateAdmissionHistoryPath, gateNodeReservation, readGateNodeReservation, writeGateNodePeak } from '../../scripts/gate-admission-history.ts';
import { GiB } from '../../scripts/gate-resources.ts';
import { tmpdir } from '../support/temporary.ts';

// @feature docs/engineering/testing/cli.md#并发
test('file PSS history strictly validates cache records and atomically replaces the last peak per absolute path', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ directory: tmpdir(), prefix: 'concord-admission-history-' });
  const file = join(root, 'first/file.test.ts'), other = join(root, 'second/file.test.ts');
  const cache = join(root, 'user-cache');
  assert.equal(yield* readGateNodeReservation(file, cache), 2 * GiB);
  for (const [peak, expected] of [[0, 0.5], [GiB / 2, 0.5], [GiB / 2 + 1, 1], [2 * GiB + 1, 2.5]]) {
    yield* writeGateNodePeak(file, peak!, cache);
    assert.equal(yield* readGateNodeReservation(file, cache), expected! * GiB);
    assert.equal(yield* readGateNodeReservation(other, cache), 2 * GiB);
    assert.deepEqual(yield* fs.readDirectory(cache), [gateAdmissionHistoryPath(file, cache).split('/').at(-1)]);
  }
  assert.equal(gateNodeReservation(), 2 * GiB);
  const path = gateAdmissionHistoryPath(file, cache);
  const valid = Schema.decodeUnknownSync(Schema.fromJsonString(GateAdmissionPeak), { onExcessProperty: 'error' })(yield* fs.readFileString(path));
  for (const invalid of ['{', JSON.stringify({ ...valid, peakBytes: -1 }), JSON.stringify({ ...valid, peakBytes: 0.5 }),
    JSON.stringify({ ...valid, peakBytes: '1' }), JSON.stringify({ ...valid, extra: true }), JSON.stringify({ ...valid, file: other })]) {
    yield* fs.writeFileString(path, invalid);
    const result = yield* Effect.result(readGateNodeReservation(file, cache));
    assert.equal(result._tag, 'Failure');
    if (result._tag === 'Failure') assert.equal(result.failure._tag, 'GateAdmissionHistoryInvalid');
  }
  yield* writeGateNodePeak(file, GiB / 4, cache);
  assert.equal(yield* readGateNodeReservation(file, cache), GiB / 2);
})).pipe(Effect.provide(NodeServices.layer))));
