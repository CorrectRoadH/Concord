import assert from 'node:assert/strict';
import test from 'node:test';
import { join, resolve } from 'node:path';
import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { prepareHerdrModMirror } from '../../scripts/herdr-mod-release.ts';

// @use-case docs/feature/cross-platform-release/use-case/release-from-tag.md
test('Herdr mirror maps an installed package to the catalog directory without rebuilding its assets', () => Effect.runPromise(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-herdr-release-test-' });
  const input = join(root, 'package'), output = join(root, 'mirror');
  const assets = join(input, 'dist/herdr-mod');
  yield* fs.makeDirectory(assets, { recursive: true });
  yield* fs.makeDirectory(join(output, 'unrelated'), { recursive: true });
  yield* fs.writeFileString(join(output, 'unrelated/keep'), 'keep');
  yield* fs.writeFileString(join(input, 'package.json'), JSON.stringify({ name: 'concord-sdlc', version: '1.2.3', bin: { concord: 'dist/entry/cli/entry.js' } }));
  const main = 'export default class Concord {}\n';
  const manifest = JSON.stringify({ place: 'right', size: 760, minimumConcordVersion: '1.2.3', overlay: { width: 760, height: 220 } });
  const preview = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=', 'base64'));
  yield* fs.writeFileString(join(assets, 'main.js'), main);
  yield* fs.writeFileString(join(assets, 'mod.json'), manifest);
  yield* fs.writeFileString(join(assets, 'NOTICE.txt'), 'packaged license\n');
  yield* fs.writeFile(join(assets, 'preview.png'), preview);
  const result = yield* prepareHerdrModMirror(input, output, 'v1.2.3');
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
  assert.match(recipe, /readTextFile、writeTextFile/u);
  assert.equal(yield* fs.readFileString(join(output, 'unrelated/keep')), 'keep');
  yield* fs.writeFileString(join(catalog, 'mods/concord/stale.js'), 'old');
  yield* prepareHerdrModMirror(input, output, 'concord-v1.2.3');
  assert.equal(yield* fs.exists(join(catalog, 'mods/concord/stale.js')), false);
  const cliOutput = yield* spawner.string(ChildProcess.make(process.execPath, [
    '--import', import.meta.resolve('tsx'), resolve('scripts/herdr-mod-release.ts'), input, join(root, 'cli-mirror'), 'v1.2.3',
  ]));
  assert.match(cliOutput, /Prepared Concord Herdr mod 1\.2\.3/u);
  assert.deepEqual(yield* fs.readFile(join(root, 'cli-mirror/concord/preview.png')), yield* fs.readFile(join(assets, 'preview.png')));

  for (const tag of ['v1.2.4', 'v01.2.3', 'v1.2.3-extra', '']) {
    const invalid = yield* prepareHerdrModMirror(input, output, tag).pipe(Effect.flip);
    assert.equal(invalid._tag, 'HerdrModReleaseInvalid');
    assert.equal(yield* fs.readFileString(join(catalog, 'mods/concord/main.js')), main);
  }
  yield* fs.writeFileString(join(assets, 'mod.json'), JSON.stringify({ place: 'right', size: 760, minimumConcordVersion: '1.2.2' }));
  assert.match((yield* prepareHerdrModMirror(input, output, 'v1.2.3').pipe(Effect.flip)).message, /must agree/u);
  yield* fs.writeFileString(join(assets, 'mod.json'), manifest);
  yield* fs.remove(join(assets, 'preview.png'));
  assert.match((yield* prepareHerdrModMirror(input, output, 'v1.2.3').pipe(Effect.flip)).message, /preview.png/u);
  yield* fs.writeFileString(join(assets, 'preview.png'), 'not a screenshot');
  assert.match((yield* prepareHerdrModMirror(input, output, 'v1.2.3').pipe(Effect.flip)).message, /PNG/u);
  assert.match((yield* prepareHerdrModMirror(input, input, 'v1.2.3').pipe(Effect.flip)).message, /overlap/u);
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))));
