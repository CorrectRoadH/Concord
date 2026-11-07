import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { join, resolve } from 'node:path';
import { packJavaScript, p5RuntimeNotice } from './pack-javascript.ts';
import { P5_LIBRARIES } from "../src/model/p5/index.ts";
import { captureBuildSource, writeBuildIdentity } from './build-identity.ts';
import { assembleArchive } from './archive.ts';
import { archivePartInput, cachedArchivePart } from './application-cache.ts';
import { externalBuildOutput } from './build-output.ts';
import { archiveTarget } from './archive-support.ts';
import { assertCompilationHost } from './compile-application.ts';
import { sourceWebDigest } from '../src/base/installation/index.ts';
import { buildHerdrModAssets } from './build-herdr-mod.ts';
import { modManifest } from '../src/model/herdr-mod/index.ts';

let outputRoot: string;
const dist = (path = '') => join(outputRoot, 'dist', path);

class BuildFailed extends Schema.TaggedError<BuildFailed>()('BuildFailed', {
  project: Schema.String,
  exitCode: Schema.Number,
}) {}

class BuildOutputFailed extends Schema.TaggedError<BuildOutputFailed>()('BuildOutputFailed', {
  file: Schema.String,
  message: Schema.String,
}) {}

/** Check the complete application; Bun consumes source and emits no application JS. */
const typecheck = Effect.fn('build.typecheck')(function*() {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  for (const project of ['tsconfig.json', 'tsconfig.web.json']) {
    const exitCode = Number(yield* spawner.exitCode(ChildProcess.make(process.execPath,
      ['node_modules/typescript/bin/tsc', '-p', project, '--noEmit'], { stdout: 'inherit', stderr: 'inherit' })));
    if (exitCode !== 0) return yield* new BuildFailed({ project, exitCode });
  }
});

const finish = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  yield* Effect.tryPromise(async () => {
    const { build } = await import('vite');
    await build({ configFile: 'vite.preview.config.ts', build: { outDir: dist('preview') } });
  });
  yield* packJavaScript({ entry: { 'p5-runtime': 'web/p5/runtime.ts' }, outDir: dist('web'), format: 'iife', platform: 'browser', target: 'es2022', minify: true,
    deps: { alwaysBundle: /.*/u, onlyBundle: false }, define: { IS_MINIFIED: 'true' },
    plugins: [p5RuntimeNotice],
    outputOptions: { entryFileNames: '[name].js', comments: { legal: true } } });
  yield* fs.copyFile('node_modules/p5/license.txt', dist('web/P5-LICENSE.txt'));
  yield* fs.copy('node_modules/p5/types', dist('p5-types'));
  yield* fs.makeDirectory(dist('web/p5-libraries'), { recursive: true });
  for (const library of Object.values(P5_LIBRARIES)) {
    yield* fs.copyFile(library.source, dist(`web/p5-libraries/${library.file}`));
    yield* fs.copyFile(library.license, dist(`web/p5-libraries/${library.file}.LICENSE`));
  }
  yield* fs.copyFile('node_modules/@fontsource-variable/noto-sans-sc/LICENSE', dist('web/FONT-LICENSE.txt'));
  const fontLicense = yield* fs.readFileString('node_modules/@fontsource-variable/noto-sans-sc/LICENSE');
  yield* fs.writeFileString(dist('preview/FONT-LICENSE.html'), `<!doctype html><meta charset="utf-8"><title>Font license</title><pre>${fontLicense.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</pre>`);
});

const copyPart = Effect.fn('build.copyPart')(function*(part: string, output: string) {
  const fs = yield* FileSystem.FileSystem;
  for (const name of yield* fs.readDirectory(part)) {
    if (name !== '.application-cache.json') yield* fs.copy(join(part, name), join(output, name), { overwrite: true });
  }
});

/** Build parts by their own inputs, then bind identity only in the private copy. */
export const buildApplication = (output: string): Promise<void> => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const repository = resolve(import.meta.dirname, '..');
  const destination = yield* externalBuildOutput(output);
  yield* typecheck();
  const tooling = ['scripts/distribution.ts', 'scripts/application-cache.ts', 'scripts/gate-build-cache.ts', 'scripts/pack-javascript.ts',
    'scripts/build-herdr-mod.ts', 'scripts/herdr-mod-catalog.ts', 'scripts/build-identity.ts', 'scripts/build-output.ts', 'bun.lock', 'patches', 'package.json', 'tsconfig.json', 'tsconfig.web.json', 'node_modules/typescript/package.json', 'node_modules/esbuild/package.json', 'node_modules/vite/package.json'];
  const resourcePaths = ['docs', 'skills', 'templates', ...(yield* fs.readDirectory(repository)).filter(name => /^README(?:\..+)?\.md$/u.test(name))];
  const resourceInput = () => archivePartInput(repository, [...resourcePaths, 'scripts/distribution.ts', 'scripts/application-cache.ts', 'scripts/gate-build-cache.ts']);
  const resourceDigest = yield* resourceInput();
  const resources = yield* cachedArchivePart('resources', resourceDigest, directory => Effect.gen(function*() {
    yield* fs.makeDirectory(directory, { recursive: true });
    for (const name of resourcePaths) yield* fs.copy(join(repository, name), join(directory, name));
  }), resourceInput);
  const webInput = () => Effect.gen(function*() {
    return yield* archivePartInput(repository, [...tooling, 'src/model/p5', 'src/model/herdr-mod', 'src/entry/herdr-mod'], yield* sourceWebDigest(repository));
  });
  const webDigest = yield* webInput();
  const web = yield* cachedArchivePart('web', webDigest, directory => Effect.gen(function*() {
    outputRoot = directory;
    yield* fs.makeDirectory(dist(), { recursive: true });
    yield* Effect.tryPromise(async () => {
      const { build } = await import('vite');
      await build({ configFile: 'vite.source.config.ts', build: { outDir: dist('web'), write: true, minify: true, license: true, emptyOutDir: true } });
    });
    yield* finish;
    yield* buildHerdrModAssets(dist('herdr-mod'));
  }), webInput);
  yield* fs.remove(destination, { recursive: true, force: true });
  yield* fs.makeDirectory(destination, { recursive: true });
  for (const part of [resources, web]) yield* copyPart(part, destination);
  for (const name of ['package.json', 'bun.lock']) yield* fs.copyFile(join(repository, name), join(destination, name));
  if (yield* fs.exists(join(repository, 'patches'))) yield* fs.copy(join(repository, 'patches'), join(destination, 'patches'));
  const identity = yield* captureBuildSource();
  const manifest = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))(yield* fs.readFileString(join(destination, 'package.json')));
  yield* fs.writeFileString(join(destination, 'package.json'), `${JSON.stringify({ ...manifest, bin: { concord: '../bin/concord' }, gitHead: identity.commit })}\n`);
  const version = yield* Schema.decodeUnknownEffect(Schema.String)(manifest.version);
  yield* fs.writeFileString(join(destination, 'dist/herdr-mod/mod.json'), `${JSON.stringify(modManifest(version))}\n`);
  yield* writeBuildIdentity(identity, join(destination, 'dist'));
  if ((yield* resourceInput()) !== resourceDigest || (yield* webInput()) !== webDigest) return yield* new BuildOutputFailed({ file: destination, message: 'Application inputs changed while assembling parts' });
})).pipe(Effect.provide(NodeServices.layer)));

export const buildDistribution = async (output: string): Promise<void> => {
  const target = archiveTarget();
  assertCompilationHost(target);
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const temporary = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-application-' });
    const applicationRoot = join(temporary, 'app');
    yield* Effect.tryPromise({ try: () => buildApplication(applicationRoot), catch: cause => cause });
    yield* assembleArchive({ target, applicationRoot, outputRoot: output });
  })).pipe(Effect.provide(NodeServices.layer)));
};
