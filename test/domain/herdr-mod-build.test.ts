import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem } from 'effect';
import { buildHerdrModCatalog } from '../../scripts/build-herdr-mod.ts';
import { modIconNames } from '../../src/model/herdr-mod/index.ts';

// @use-case docs/engineering/build/use-case/share-herdr-mod.md
// @issue docs/issues/herdr-catalog-recipe-drift.md
test('standalone Herdr build produces a reproducible installable catalog without a release archive', () => Effect.runPromise(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-herdr-catalog-test-' });
  const first = yield* buildHerdrModCatalog(join(root, 'first'));
  const second = yield* buildHerdrModCatalog(join(root, 'second'));
  assert.deepEqual((yield* fs.readDirectory(join(root, 'first'))), ['concord']);
  for (const file of ['RECIPE.md', 'preview.png', 'mods/concord/main.js', 'mods/concord/mod.json', 'mods/concord/NOTICE.txt']) {
    assert.deepEqual(yield* fs.readFile(join(first.directory, file)), yield* fs.readFile(join(second.directory, file)), file);
    assert.deepEqual(yield* fs.readFile(join(first.directory, file)), yield* fs.readFile(join('concord', file)), `Run bun run build:herdr to refresh ${file}`);
  }
  assert.deepEqual((yield* fs.readDirectory(join(first.directory, 'mods/concord'))).sort(), ['NOTICE.txt', 'icons', 'main.js', 'mod.json']);
  for (const name of modIconNames) {
    const relative = `mods/concord/icons/${name}.svg`;
    assert.deepEqual(yield* fs.readFile(join(first.directory, relative)), yield* fs.readFile(join(second.directory, relative)));
    assert.deepEqual(yield* fs.readFile(join(first.directory, relative)), yield* fs.readFile(join('concord', relative)));
    assert.match(yield* fs.readFileString(join(first.directory, relative)), /stroke="currentColor"/u);
  }
  assert.match(yield* fs.readFileString(join(first.directory, 'mods/concord/NOTICE.txt')), /Lucide:[\s\S]*ISC License/u);
  const bundle = yield* fs.readFileString(join(first.directory, 'mods/concord/main.js'));
  assert.match(bundle, /from[ ]*["']herdr["']/u);
  assert.doesNotMatch(bundle, /sourceMappingURL|concord-herdr-build-|node_modules\//u);
  assert.match(yield* fs.readFileString(join(first.directory, 'RECIPE.md')), /releases\/latest\/download\/install.sh/u);
  assert.deepEqual(yield* fs.readFile(join(first.directory, 'preview.png')), yield* fs.readFile('src/entry/herdr-mod/preview.png'));
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))));
