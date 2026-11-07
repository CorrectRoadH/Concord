import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { prepareHerdrModCatalog } from '../../scripts/herdr-mod-catalog.ts';

// @use-case docs/engineering/build/use-case/share-herdr-mod.md
test('Herdr catalog validates generated assets before replacing the installable directory', () => Effect.runPromise(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-herdr-release-test-' });
  const input = join(root, 'package'), output = join(root, 'mirror');
  const assets = join(input, 'dist/herdr-mod');
  yield* fs.makeDirectory(assets, { recursive: true });
  yield* fs.makeDirectory(join(output, 'unrelated'), { recursive: true });
  yield* fs.writeFileString(join(output, 'unrelated/keep'), 'keep');
  const main = 'export default class Concord {}\n';
  const manifest = JSON.stringify({ place: 'right', size: 760, minimumConcordVersion: '1.2.3', overlay: { width: 760, height: 220 } });
  const preview = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=', 'base64'));
  yield* fs.writeFileString(join(assets, 'main.js'), main);
  yield* fs.writeFileString(join(assets, 'mod.json'), manifest);
  yield* fs.writeFileString(join(assets, 'NOTICE.txt'), 'packaged license\n');
  yield* fs.writeFile(join(assets, 'preview.png'), preview);
  const result = yield* prepareHerdrModCatalog(assets, output, '1.2.3');
  assert.deepEqual(result, { version: '1.2.3', directory: join(output, 'concord') });
  const catalog = join(output, 'concord');
  assert.deepEqual((yield* fs.readDirectory(catalog)).sort(), ['RECIPE.md', 'mods', 'preview.png']);
  assert.deepEqual((yield* fs.readDirectory(join(catalog, 'mods/concord'))).sort(), ['NOTICE.txt', 'main.js', 'mod.json']);
  for (const name of ['main.js', 'mod.json', 'NOTICE.txt']) {
    assert.deepEqual(yield* fs.readFile(join(catalog, 'mods/concord', name)), yield* fs.readFile(join(assets, name)));
  }
  assert.deepEqual([...(yield* fs.readFile(join(catalog, 'preview.png')))], [...preview], 'preview must come from the package bytes');
  const recipe = yield* fs.readFileString(join(catalog, 'RECIPE.md'));
  assert.match(recipe, /^# Concord\n/u);
  assert.match(recipe, /!\[Concord\]\(preview\.png\)/u);
  const headings = [...recipe.matchAll(/^## (.+)$/gmu)].map(match => match[1]);
  assert.deepEqual(headings, ['What you see', 'How it behaves', 'Built from', 'Watch out', 'Done when']);
  assert.match(recipe, /minimumConcordVersion=1\.2\.3/u);
  assert.match(recipe, /herdr-app check/u);
  assert.match(recipe, /action file.get\/document.set、workspace wait/u);
  assert.equal(yield* fs.readFileString(join(output, 'unrelated/keep')), 'keep');
  yield* fs.writeFileString(join(catalog, 'mods/concord/stale.js'), 'old');
  yield* prepareHerdrModCatalog(assets, output, '1.2.3');
  assert.equal(yield* fs.exists(join(catalog, 'mods/concord/stale.js')), false);
  for (const tag of ['1.2.4', 'invalid', 'v1.2.3', '']) {
    const invalid = yield* prepareHerdrModCatalog(assets, output, tag).pipe(Effect.flip);
    assert.equal(invalid._tag, 'HerdrModCatalogInvalid');
    assert.equal(yield* fs.readFileString(join(catalog, 'mods/concord/main.js')), main);
  }
  yield* fs.writeFileString(join(assets, 'mod.json'), JSON.stringify({ place: 'right', size: 760, minimumConcordVersion: '1.2.2' }));
  assert.match((yield* prepareHerdrModCatalog(assets, output, '1.2.3').pipe(Effect.flip)).message, /must agree/u);
  yield* fs.writeFileString(join(assets, 'mod.json'), manifest);
  yield* fs.remove(join(assets, 'preview.png'));
  assert.match((yield* prepareHerdrModCatalog(assets, output, '1.2.3').pipe(Effect.flip)).message, /preview.png/u);
  yield* fs.writeFileString(join(assets, 'preview.png'), 'not a screenshot');
  assert.match((yield* prepareHerdrModCatalog(assets, output, '1.2.3').pipe(Effect.flip)).message, /PNG/u);
  assert.match((yield* prepareHerdrModCatalog(join(output, 'concord'), output, '1.2.3').pipe(Effect.flip)).message, /overlap/u);
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))));
