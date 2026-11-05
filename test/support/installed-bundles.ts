import assert from 'node:assert/strict';
import { SourceMap } from 'node:module';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode } from '@jridgewell/sourcemap-codec';
import { Effect, FileSystem, Schema } from 'effect';

const BundleMap = Schema.fromJsonString(Schema.Struct({
  version: Schema.Literal(3), file: Schema.String, names: Schema.Array(Schema.String),
  sources: Schema.Array(Schema.String), sourcesContent: Schema.Array(Schema.NullOr(Schema.String)),
  mappings: Schema.String, sourceRoot: Schema.optional(Schema.String), ignoreList: Schema.optional(Schema.Array(Schema.Int)),
}));
const repository = fileURLToPath(new URL('../..', import.meta.url));

/** Inspect the extracted candidate; never build a second copy of its bundles. */
export const verifyInstalledBundles = Effect.fn('test.verifyInstalledBundles')(function*(packageRoot: string, sourceRoot = repository) {
  const fs = yield* FileSystem.FileSystem;
  for (const [file, source] of [
    ['dist/herdr-mod/main.js', 'src/entry/herdr-mod/main.ts'],
    ['dist/web/p5-runtime.js', 'web/p5/runtime.ts'],
  ] as const) {
    const javascript = yield* fs.readFileString(join(packageRoot, file));
    assert.equal(/\n\/\/# sourceMappingURL=([^\s]+)\s*$/u.exec(javascript)?.[1], `${basename(file)}.map`, `${file}: missing source map link`);
    const map = yield* Schema.decodeUnknownEffect(BundleMap, { onExcessProperty: 'error' })(yield* fs.readFileString(join(packageRoot, `${file}.map`)));
    assert.equal(map.file, basename(file), `${file}: map names another bundle`);
    const sourceIndex = map.sources.findIndex(path => path.endsWith(`/${source}`));
    assert.notEqual(sourceIndex, -1, `${file}: missing authored source ${source}`);
    const original = yield* fs.readFileString(join(sourceRoot, source));
    assert.equal(map.sourcesContent[sourceIndex], original, `${file}: embedded authored source differs`);
    const mappings = decode(map.mappings);
    const line = mappings.findIndex(segments => segments.some(segment => segment.length >= 4 && segment[1] === sourceIndex));
    assert.notEqual(line, -1, `${file}: no mapping reaches ${source}`);
    const segment = mappings[line]!.find(segment => segment.length >= 4 && segment[1] === sourceIndex)!;
    const location = new SourceMap({
      ...map, sourceRoot: map.sourceRoot ?? '', sources: [...map.sources], names: [...map.names],
      sourcesContent: map.sourcesContent.map(content => content ?? ''),
    }).findEntry(line, segment[0]);
    assert.ok('originalSource' in location, `${file}: source map lookup returned no source`);
    assert.equal(location.originalSource, map.sources[sourceIndex], `${file}: source map lookup`);
    const originalLines = original.split('\n');
    assert.ok(location.originalLine >= 0 && location.originalLine < originalLines.length, `${file}: original line is outside its source`);
    assert.ok(location.originalColumn >= 0 && location.originalColumn < originalLines[location.originalLine]!.length, `${file}: original column is outside its source`);
    assert.ok(segment[0] < javascript.split('\n')[line]!.length, `${file}: generated position is outside its bundle`);
  }
  const effectLicense = yield* fs.readFileString(join(repository, 'node_modules/effect/LICENSE'));
  const notice = yield* fs.readFileString(join(packageRoot, 'dist/herdr-mod/NOTICE.txt'));
  assert.ok(notice.endsWith(effectLicense), 'Herdr mod must carry the complete Effect license');
  assert.equal(yield* fs.readFileString(join(packageRoot, 'dist/web/P5-LICENSE.txt')), yield* fs.readFileString(join(repository, 'node_modules/p5/license.txt')));
  const legal = yield* fs.readFileString(join(packageRoot, 'dist/web/p5-runtime.js.LEGAL.txt'));
  assert.match(legal, /pako [\d.]+ https:\/\/github\.com\/nodeca\/pako @license \(MIT AND Zlib\)/u);
});
