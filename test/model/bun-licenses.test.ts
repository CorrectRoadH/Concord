// @concord-file
// @concord-implements docs/feature/cross-platform-release/architecture.md#归档构成
import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem } from 'effect';
import { copyBunLicenseSources } from '../../scripts/bun-licenses.ts';
import { command, sha256 } from '../../scripts/archive-support.ts';

// @feature docs/feature/cross-platform-release/architecture.md#归档构成
test('Bun licenses extract verified crate and scoped npm members and reject changed license bytes', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-bun-licenses-' });
  const members = ['crate-1.0.0+build/LICENSE-MIT', 'package/dist/licenses/@babel/types/LICENSE'];
  const bytes = 'Original upstream copyright and license text\n';
  for (const path of members) {
    yield* fs.makeDirectory(join(root, path, '..'), { recursive: true });
    yield* fs.writeFileString(join(root, path), bytes);
  }
  const archive = join(root, 'fixture.tgz');
  yield* command('tar', ['-czf', archive, '-C', root, ...members]);
  const digest = sha256(yield* fs.readFile(archive));
  const cache = join(root, 'downloads');
  yield* fs.makeDirectory(cache);
  yield* fs.copyFile(archive, join(cache, digest));
  const source = { component: 'fixture', evidence: 'fixture', url: 'https://example.com/fixture.crate', sha256: digest, files: members.map(path => ({ path, sha256: sha256(bytes) })) };
  const output = join(root, 'output');
  const copied = yield* copyBunLicenseSources(output, [source], cache);
  assert.equal(copied?.length, 2);
  for (const file of copied ?? []) assert.equal(yield* fs.readFileString(join(output, 'licenses', file.file)), bytes);
  const failed = yield* Effect.result(copyBunLicenseSources(output, [{ ...source, files: [{ path: members[0]!, sha256: '0'.repeat(64) }] }], cache));
  assert.equal(failed._tag, 'Failure');
  assert.match(String(failed), /SHA-256 mismatch/u);
})).pipe(Effect.provide(NodeServices.layer))));
