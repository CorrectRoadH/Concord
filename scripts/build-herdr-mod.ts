// @concord-file
// @concord-implements docs/engineering/build/use-case/share-herdr-mod.md
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema } from 'effect';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { modManifest, ModVersion } from '../src/model/herdr-mod/index.ts';
import { buildHerdrModResources } from '../src/base/installation/index.ts';
import { packJavaScript } from './pack-javascript.ts';
import { prepareHerdrModCatalog } from './herdr-mod-catalog.ts';

export class HerdrModBuildFailed extends Schema.TaggedError<HerdrModBuildFailed>()('HerdrModBuildFailed', {
  message: Schema.String,
}) {}

/** Shared by standalone catalog generation and complete CLI archives. */
export const buildHerdrModAssets: (output: string) => Effect.Effect<void, HerdrModBuildFailed, FileSystem.FileSystem> = Effect.fn('buildHerdrModAssets')(function*(output: string) {
  const fs = yield* FileSystem.FileSystem;
  const version = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ version: ModVersion })), { onExcessProperty: 'ignore' })(yield* fs.readFileString('package.json'));
  yield* packJavaScript({ define: { CONCORD_MOD_MINIMUM_VERSION: JSON.stringify(version.version) }, entry: { main: 'src/entry/herdr-mod/main.ts' }, outDir: output, format: 'esm', platform: 'neutral', target: 'es2022', minify: true, sourcemap: false,
    deps: { neverBundle: ['gpui-kit', 'gpui-base', 'herdr', 'fs/promises', 'buffer', 'crypto'], alwaysBundle: /^(?!gpui-kit$|gpui-base$|herdr$|fs\/promises$|buffer$|crypto$)/u, onlyBundle: false },
    outputOptions: { entryFileNames: '[name].js', comments: { legal: true } } });
  yield* fs.copyFile('src/entry/herdr-mod/preview.png', join(output, 'preview.png'));
  yield* buildHerdrModResources(output, process.cwd());
}, Effect.mapError(cause => new HerdrModBuildFailed({ message: String(cause) })));

export const buildHerdrModCatalog: (repositoryRoot: string) => Effect.Effect<{ version: string; directory: string }, HerdrModBuildFailed, FileSystem.FileSystem> = Effect.fn('buildHerdrModCatalog')(function*(repositoryRoot: string) {
  const fs = yield* FileSystem.FileSystem;
  const manifest = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ version: ModVersion })), { onExcessProperty: 'ignore' })(yield* fs.readFileString('package.json'));
  const assets = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-herdr-build-' });
  yield* buildHerdrModAssets(assets);
  yield* fs.writeFileString(join(assets, 'mod.json'), `${JSON.stringify(modManifest(manifest.version))}\n`);
  return yield* prepareHerdrModCatalog(assets, repositoryRoot, manifest.version);
}, Effect.scoped, Effect.mapError(cause => new HerdrModBuildFailed({ message: String(cause) })));

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  buildHerdrModCatalog(process.cwd()).pipe(
    Effect.tap(result => Effect.sync(() => process.stdout.write(`Prepared Concord Herdr mod ${result.version}: ${result.directory}\n`))),
    Effect.provide(NodeServices.layer), NodeRuntime.runMain,
  );
}
