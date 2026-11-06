// @concord-file
// @concord-implements docs/engineering/build/architecture.md#从源码运行
import type * as EffectTypes from 'effect';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { Clock, Effect, FileSystem, Schema } from 'effect';
import { NodeServices } from '@effect/platform-node';
import { makeOwnedProcessService, hasSuccessfulOwnedProcessResult } from '../process/index.ts';
import { packageRoot } from './location.ts';
import { workerEntryArgv } from './index.ts';
import { sourceWebInputDigest, sourceWebRuntimeImports, webHash } from './source-web-inputs.ts';

export class SourceWebCacheError extends Schema.TaggedError<SourceWebCacheError>()('SourceWebCacheError', {
  phase: Schema.Literals(['inputs', 'integrity', 'lock', 'build', 'publish', 'read']),
  message: Schema.String,
}) {}
export const webFailure = (phase: SourceWebCacheError['phase']) => (cause: unknown): SourceWebCacheError => cause instanceof SourceWebCacheError
  ? cause : new SourceWebCacheError({ phase, message: cause instanceof Error ? cause.message : String(cause) });

export const WebDigest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u));
const SafeFile = Schema.String.check(Schema.isPattern(/^(?!.*(?:^|\/)\.\.?(?:\/|$))(?:web|preview|p5)\/[^\\\u0000]+$/u));
export const WebReceipt = Schema.Struct({
  format: Schema.Literal('concord.source-web/v1'), digest: WebDigest,
  builderPid: Schema.Int.check(Schema.isGreaterThan(0)),
  files: Schema.Array(Schema.Struct({ path: SafeFile, sha256: WebDigest, size: Schema.Int.check(Schema.isGreaterThan(0)) })),
});
export type WebReceipt = typeof WebReceipt.Type;
const PackageIdentity = Schema.Struct({ name: Schema.String, version: Schema.String });
const DependencyManifest = Schema.Struct({
  dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  devDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
export const sourceWebCacheDirectory = (): string => {
  const configured = process.env.XDG_CACHE_HOME;
  return join(configured && isAbsolute(configured) ? configured : join(homedir(), '.cache'), 'concord', 'web');
};

export const webFiles = Effect.fn('webFiles')(function*(directory: string, prefix = ''): Effect.fn.Return<readonly string[], unknown, FileSystem.FileSystem> {
  const fs = yield* FileSystem.FileSystem;
  const files: string[] = [];
  for (const name of (yield* fs.readDirectory(join(directory, prefix))).sort()) {
    const path = prefix ? `${prefix}/${name}` : name;
    const info = yield* fs.stat(join(directory, path));
    if (info.type === 'Directory') files.push(...yield* webFiles(directory, path));
    else if (info.type === 'File') files.push(path);
    else return yield* new SourceWebCacheError({ phase: 'inputs', message: `Unsupported Web input: ${path}` });
  }
  return files;
});

/** Capture real browser runtime dependencies, never the CLI/server or an entire src tree. */
export const sourceWebDigest = Effect.fn('sourceWebDigest')(function*(root: string) {
  const fs = yield* FileSystem.FileSystem;
  const inputs = new Map<string, Uint8Array>();
  const packages = new Set(['vite-plus', 'esbuild', 'typescript', '@fontsource-variable/noto-sans-sc']);
  const queue = (yield* webFiles(join(root, 'web'))).map(path => `web/${path}`);
  queue.push('vite.source.config.ts', 'vite.preview.config.ts');
  const read = (path: string) => fs.readFile(join(root, path)).pipe(Effect.map(bytes => { inputs.set(path, bytes); return bytes; }));
  while (queue.length) {
    const path = queue.pop()!;
    if (inputs.has(path)) continue;
    const bytes = yield* read(path);
    if (!/\.(?:[cm]?[jt]sx?|css)$/u.test(path)) continue;
    for (const specifier of sourceWebRuntimeImports(Buffer.from(bytes).toString('utf8'))) {
      if (!specifier.startsWith('.')) {
        if (!specifier.startsWith('node:') && !specifier.startsWith('@/')) packages.add(specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!);
        continue;
      }
      const target = relative(root, resolve(root, dirname(path), specifier));
      if (isAbsolute(target) || target === '..' || target.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) return yield* new SourceWebCacheError({ phase: 'inputs', message: `Web input escapes installation: ${specifier}` });
      const candidates = [target, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`, `${target}/index.tsx`];
      let found: string | undefined;
      for (const candidate of candidates) {
        if (yield* fs.exists(join(root, candidate))) {
          if ((yield* fs.stat(join(root, candidate))).type === 'File') { found = candidate; break; }
        }
      }
      if (found === undefined) return yield* new SourceWebCacheError({ phase: 'inputs', message: `Cannot resolve Web input ${path}: ${specifier}` });
      queue.push(found.replaceAll('\\', '/'));
    }
  }
  for (const path of ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'src/base/installation/source-web-inputs.ts', 'src/base/installation/source-web-cache.ts', 'src/base/installation/source-web-builder.ts']) yield* read(path);
  // Vite discovers the nearest tsconfig even though all output targets are explicit.
  if (yield* fs.exists(join(root, 'tsconfig.json'))) yield* read('tsconfig.json');
  const manifest = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(DependencyManifest))(yield* fs.readFileString(join(root, 'package.json')));
  const declared = { ...manifest.dependencies, ...manifest.devDependencies };
  for (const name of [...packages].sort()) {
    const metadata = yield* fs.readFileString(join(root, 'node_modules', name, 'package.json'));
    const identity = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PackageIdentity))(metadata);
    inputs.set(`dependency:${name}`, Buffer.from(JSON.stringify({ requested: declared[name], ...identity })));
  }
  inputs.set('builder-runtime', Buffer.from(JSON.stringify({ node: process.versions.node, platform: process.platform, arch: process.arch })));
  return sourceWebInputDigest(inputs);
}, Effect.mapError(webFailure('inputs')));

/** Every published byte participates, including fonts and dynamically loaded chunks. */
export const readWebReceipt = Effect.fn('readWebReceipt')(function*(directory: string, digest: string) {
  const fs = yield* FileSystem.FileSystem;
  const receipt = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(WebReceipt), { onExcessProperty: 'error' })(yield* fs.readFileString(join(directory, 'receipt.json')));
  if (receipt.digest !== digest) return yield* new SourceWebCacheError({ phase: 'integrity', message: 'Web cache digest differs' });
  const names = receipt.files.map(file => file.path);
  if (names.length !== new Set(names).size || !['web/index.html', 'preview/index.html', 'preview/FONT-LICENSE.html', 'p5/runtime.js'].every(name => names.includes(name))
    || !names.some(name => name.startsWith('web/assets/') && name.endsWith('.js')) || !names.some(name => name.startsWith('preview/assets/') && name.endsWith('.js'))) {
    return yield* new SourceWebCacheError({ phase: 'integrity', message: 'Web cache is incomplete' });
  }
  const actual = (yield* webFiles(directory)).filter(path => path !== 'receipt.json').sort();
  if (JSON.stringify(actual) !== JSON.stringify([...names].sort())) return yield* new SourceWebCacheError({ phase: 'integrity', message: 'Web cache file inventory differs' });
  for (const file of receipt.files) {
    const bytes = yield* fs.readFile(join(directory, file.path));
    if (bytes.byteLength !== file.size || webHash(bytes) !== file.sha256) return yield* new SourceWebCacheError({ phase: 'integrity', message: `Web cache file differs: ${file.path}` });
  }
  return receipt;
}, Effect.mapError(webFailure('integrity')));

export const sourceWebArtifact = Effect.fn('sourceWebArtifact')(function*() {
  const digest = yield* sourceWebDigest(packageRoot);
  const directory = join(sourceWebCacheDirectory(), digest);
  if (yield* readWebReceipt(directory, digest).pipe(Effect.as(true), Effect.catch(() => Effect.succeed(false)))) return directory;
  const owner = makeOwnedProcessService();
  const started = yield* Clock.currentTimeMillis;
  const result = yield* owner.run([process.execPath, ...workerEntryArgv('web-build'), digest], {
    cwd: packageRoot, env: { ...process.env, NODE_ENV: 'production' }, timeoutMs: 180_000, outputLimitBytes: 1024 * 1024,
    // The channel conveys parent lifetime only. No application messages travel on it.
    ipc: { ready: () => {}, message: () => {} },
  });
  if (!hasSuccessfulOwnedProcessResult(result)) return yield* new SourceWebCacheError({ phase: 'build', message: `Source Web builder failed after ${(yield* Clock.currentTimeMillis) - started}ms: ${result.stderr || result.stdout || result.error || result.signal || result.exitCode}` });
  yield* readWebReceipt(directory, digest);
  return directory;
}, Effect.mapError(webFailure('build')));

/** Promise adapters retain the existing consumer API while all resources remain scoped. */
export const runSourceWeb = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | EffectTypes.Scope.Scope>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer)));
