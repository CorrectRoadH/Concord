import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem } from 'effect';
import { copyProfilePackage } from '../../scripts/profile.ts';
import { workDirectory } from '../../scripts/perf/workspace.ts';

// @feature docs/engineering/performance/architecture.md
// @issue docs/issues/profile-private-install-evidence.md
test('profile install preserves relative dependency links inside its private copy', () => Effect.runPromise(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* workDirectory('concord-profile-install-test-', false);
  const candidate = join(root, 'candidate'), output = join(root, 'profile-install');
  const link = 'app/node_modules/alias';
  yield* fs.makeDirectory(join(candidate, 'app/node_modules/dependency'), { recursive: true });
  yield* fs.writeFileString(join(candidate, 'app/node_modules/dependency/package.json'), '{"name":"dependency"}\n');
  yield* fs.symlink('./dependency', join(candidate, link));
  yield* copyProfilePackage(candidate, output);
  assert.equal(yield* fs.readLink(join(output, link)), './dependency');
  assert.equal(yield* fs.realPath(join(output, link)), join(output, 'app/node_modules/dependency'));
  yield* fs.writeFileString(join(output, link, 'package.json'), '{"name":"private"}\n');
  assert.equal(yield* fs.readFileString(join(candidate, link, 'package.json')), '{"name":"dependency"}\n');
  assert.equal(yield* fs.readLink(join(candidate, link)), './dependency');
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))));
