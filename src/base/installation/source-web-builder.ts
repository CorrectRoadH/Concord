// @concord-file
// @concord-implements docs/engineering/build/architecture.md#从源码运行
import { join } from 'node:path';
import { Clock, Context, Effect, FileSystem, Layer, Schema, type Scope } from 'effect';
import { acquireFileLease, CoordinationError, ownerIsAlive, readLeaseOwner, recoverFileLease, releaseFileLease, type FileLease } from '../publication/index.ts';
import { packageRoot } from './location.ts';
import { readWebReceipt, sourceWebCacheDirectory, sourceWebDigest, SourceWebCacheError, WebDigest, webFailure, webFiles, type WebReceipt } from './source-web-cache.ts';
import { webHash } from './source-web-inputs.ts';

const complete = (directory: string, digest: string) => readWebReceipt(directory, digest).pipe(Effect.as(true), Effect.catch(() => Effect.succeed(false)));

const acquireBuilder = Effect.fn('acquireWebBuilder')(function*(cache: string, digest: string) {
  const deadline = (yield* Clock.currentTimeMillis) + 180_000;
  const name = `${digest}.lease`, directory = join(cache, digest);
  for (;;) {
    if (yield* complete(directory, digest)) return undefined;
    const lease = yield* Effect.try({
      try: () => {
        try { return acquireFileLease(cache, cache, name, 'exclusive', 'source-web-build'); }
        catch (cause) {
          if (!(cause instanceof CoordinationError) || cause.reason !== 'occupied') throw cause;
          const owner = readLeaseOwner(join(cache, name), 'source-web-build');
          if (owner !== undefined && owner.root === cache && !ownerIsAlive(owner)) {
            try { recoverFileLease(cache, join(cache, name), 'source-web-build'); }
            catch (recovery) {
              // Another waiter can reclaim the same dead owner and acquire in
              // between our observation and recovery. Its live token wins.
              const current = readLeaseOwner(join(cache, name), 'source-web-build');
              if (current !== undefined && !ownerIsAlive(current)) throw recovery;
            }
          }
          return undefined;
        }
      }, catch: webFailure('lock'),
    });
    if (lease !== undefined) return lease;
    if ((yield* Clock.currentTimeMillis) >= deadline) return yield* new SourceWebCacheError({ phase: 'lock', message: `Timed out waiting for Web builder ${digest}` });
    yield* Effect.sleep('100 millis');
  }
});

/** This is the only process allowed to load bundlers. Output paths are always cache-private. */
const compileWeb = Effect.fn('compileSourceWeb')(function*(root: string, temporary: string) {
  const fs = yield* FileSystem.FileSystem;
  yield* Effect.tryPromise({
    try: async () => {
      const { build } = await import('vite-plus');
      await build({ configFile: join(root, 'vite.source.config.ts'), mode: 'production', logLevel: 'error', envFile: false,
        configLoader: 'native', build: { write: true, outDir: join(temporary, 'web'), emptyOutDir: true } });
      await build({ configFile: join(root, 'vite.preview.config.ts'), mode: 'production', logLevel: 'error', envFile: false,
        configLoader: 'native', build: { write: true, outDir: join(temporary, 'preview'), emptyOutDir: true } });
      const { build: esbuild } = await import('esbuild');
      await esbuild({ entryPoints: [join(root, 'web/p5/runtime.ts')], outfile: join(temporary, 'p5/runtime.js'),
        write: true, bundle: true, format: 'iife', platform: 'browser', target: 'es2022', minify: true, define: { IS_MINIFIED: 'true' } });
    }, catch: webFailure('build'),
  });
  const license = yield* fs.readFileString(join(root, 'node_modules/@fontsource-variable/noto-sans-sc/LICENSE'));
  yield* fs.writeFileString(join(temporary, 'preview/FONT-LICENSE.html'), `<!doctype html><meta charset="utf-8"><title>Font license</title><pre>${license.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</pre>`);
});

/** A failed or interrupted build has only private temporary bytes, never a published cache entry. */
export const buildSourceWebArtifact = Effect.fn('buildSourceWebArtifact')(function*(root: string, cache: string, digest: string) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(cache, { recursive: true });
  const lease = yield* Effect.acquireRelease(acquireBuilder(cache, digest), (lease: FileLease | undefined) => lease === undefined ? Effect.void : Effect.sync(() => releaseFileLease(lease, 'source-web-build')), { interruptible: true });
  if (lease === undefined) return;
  const destination = join(cache, digest);
  if (yield* complete(destination, digest)) return;
  // Corrupt entries are disposable, but only the builder holding this digest's lease removes them.
  yield* fs.remove(destination, { recursive: true, force: true });
  // SIGKILL cannot run finalizers. Acquiring this digest's exclusive lease
  // proves that its previous builder no longer owns these private directories.
  for (const name of yield* fs.readDirectory(cache)) if (name.startsWith(`.${digest}-`)) yield* fs.remove(join(cache, name), { recursive: true, force: true });
  if ((yield* sourceWebDigest(root)) !== digest) return yield* new SourceWebCacheError({ phase: 'inputs', message: 'Web inputs changed before compilation; retry the request' });
  // The directory moves on successful publication; a scoped temp helper whose
  // finalizer requires the original path would fail after that rename.
  const temporary = yield* Effect.acquireRelease(fs.makeTempDirectory({ directory: cache, prefix: `.${digest}-` }),
    path => fs.remove(path, { recursive: true, force: true }).pipe(Effect.orDie));
  const log = process.env.CONCORD_TEST_WEB_BUILD_LOG;
  if (log !== undefined) yield* fs.writeFileString(log, `${JSON.stringify({ digest, builderPid: process.pid })}\n`, { flag: 'a' });
  yield* compileWeb(root, temporary);
  const files: WebReceipt['files'][number][] = [];
  for (const path of yield* webFiles(temporary)) {
    const bytes = yield* fs.readFile(join(temporary, path));
    files.push({ path, sha256: webHash(bytes), size: bytes.byteLength });
  }
  const receipt: WebReceipt = { format: 'concord.source-web/v1', digest, builderPid: process.pid, files };
  yield* fs.writeFileString(join(temporary, 'receipt.json'), JSON.stringify(receipt));
  yield* readWebReceipt(temporary, digest);
  if ((yield* sourceWebDigest(root)) !== digest) return yield* new SourceWebCacheError({ phase: 'inputs', message: 'Web inputs changed during compilation; retry the request' });
  yield* fs.rename(temporary, destination);
}, Effect.mapError(webFailure('publish')));

export class SourceWebBuilder extends Context.Service<SourceWebBuilder, {
  readonly run: Effect.Effect<void, SourceWebCacheError, Scope.Scope>;
}>()('concord/SourceWebBuilder') {}

/** Construction captures capabilities only; cancellable work runs in the entry's program scope. */
export const SourceWebBuilderLive = Layer.effect(SourceWebBuilder, Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  return SourceWebBuilder.of({
    run: Effect.gen(function*() {
      const [digest] = yield* Schema.decodeUnknownEffect(Schema.Tuple([WebDigest]))(process.argv.slice(2));
      yield* buildSourceWebArtifact(packageRoot, sourceWebCacheDirectory(), digest);
    }).pipe(Effect.provideService(FileSystem.FileSystem, fs), Effect.mapError(webFailure('build'))),
  });
}));
