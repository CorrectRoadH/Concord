// @concord-file
// @concord-implements docs/feature/cross-platform-release/use-case/release-from-tag.md
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema } from 'effect';
import { createHash } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assembleArchive } from './archive.ts';
import { buildApplication } from './distribution.ts';
import { packLibrary } from './release-library.ts';
import { io, mustRun } from './perf/process.ts';
import { decodeNativeArtifact } from '../src/base/installation/index.ts';

class ReleaseAssemblyFailed extends Schema.TaggedError<ReleaseAssemblyFailed>()('ReleaseAssemblyFailed', { message: Schema.String }) {}

/** Install the library outside the checkout: resolution cannot borrow development dependencies. */
export const verifyReleaseLibrary = Effect.fn('release.verifyLibrary')(function*(archive: string) {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-library-consumer-' });
  const options = { cwd: root, outputDir: root, timeoutMs: 120_000, env: { NODE_PATH: '', NODE_OPTIONS: '' } };
  yield* fs.writeFileString(join(root, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { 'concord-sdlc': `file:${resolve(archive)}` } }));
  yield* mustRun(['pnpm', 'install', '--ignore-scripts'], options);
  const condition = Schema.Struct({ types: Schema.String, import: Schema.String });
  yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({
    name: Schema.Literal('concord-sdlc'), version: Schema.String, gitHead: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/u)), type: Schema.Literal('module'), license: Schema.String,
    exports: Schema.Struct({ './config': condition, './model': condition, './test-adapter-protocol': condition, './change-preview': condition }),
    dependencies: Schema.Record(Schema.String, Schema.String),
  })), { onExcessProperty: 'error' })(yield* fs.readFileString(join(root, 'node_modules/concord-sdlc/package.json')));
  if (yield* fs.exists(join(root, 'node_modules/.bin/concord'))) return yield* new ReleaseAssemblyFailed({ message: 'Library installation must not expose a concord executable' });
  yield* fs.writeFileString(join(root, 'concord.config.ts'), "import type { ProjectConfig } from 'concord-sdlc/config';\nexport default { testRoots: ['test'], sourceRoots: ['src'] } satisfies ProjectConfig;\n");
  yield* mustRun([process.execPath, resolve('node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', '--target', 'esnext', '--module', 'nodenext', 'concord.config.ts'], options);
  yield* fs.writeFileString(join(root, 'invalid-config.ts'), "import type { ProjectConfig } from 'concord-sdlc/config';\nexport default { testRoot: 'test' } satisfies ProjectConfig;\n");
  const invalid = yield* mustRun([process.execPath, resolve('node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', '--target', 'esnext', '--module', 'nodenext', 'invalid-config.ts'], options).pipe(Effect.result);
  if (invalid._tag !== 'Failure' || !/\btestRoot\b/u.test(invalid.failure.message)) return yield* new ReleaseAssemblyFailed({ message: 'Library types must reject the invalid testRoot field with its diagnostic' });
  yield* fs.writeFileString(join(root, 'consumer.mjs'), `import assert from 'node:assert/strict';
import { ref_markdownAnchor } from 'concord-sdlc/model';
import { protocolJson, protocolDecode, ProcessStatusSchema } from 'concord-sdlc/test-adapter-protocol';
import { decodeChangePreview } from 'concord-sdlc/change-preview';
assert.equal(ref_markdownAnchor('# Library Consumer {#library-consumer}'), 'library-consumer');
const processStatus = { invocationId: 'library-check', exitCode: 0, signal: null, timedOut: false, cancelled: false, outputTruncated: false, cleanup: 'complete' };
assert.deepEqual(protocolDecode(ProcessStatusSchema, protocolJson(JSON.stringify(processStatus))), processStatus);
const oid = 'a'.repeat(40);
assert.equal(decodeChangePreview({ format: 'concord.change-preview/v1', comparison: { base: oid, head: oid, mergeBase: oid, baseLabel: 'main' }, entries: [] }).entries.length, 0);
`);
  yield* mustRun([process.execPath, join(root, 'consumer.mjs')], options);
}, Effect.scoped);

// @use-case docs/feature/cross-platform-release/use-case/release-from-tag.md#package
export const assembleRelease = Effect.fn('release.assemble')(function*(destination: string, applicationRoot: string, nativeArtifacts: string) {
  const fs = yield* FileSystem.FileSystem;
  const output = resolve(destination), application = resolve(applicationRoot);
  if (yield* fs.exists(output)) {
    if ((yield* fs.readDirectory(output)).length !== 0) return yield* new ReleaseAssemblyFailed({ message: 'Release output must be empty' });
  } else yield* fs.makeDirectory(output, { recursive: true });
  const identities = [];
  for (const target of ['linux-x64-glibc', 'darwin-arm64'] as const) {
    const text = yield* fs.readFileString(resolve(nativeArtifacts, target, 'artifact.json'));
    const artifact = yield* io('Decode production native identity', () => decodeNativeArtifact(JSON.parse(text)));
    if (artifact.target !== target || !artifact.portable || artifact.testHooks) return yield* new ReleaseAssemblyFailed({ message: `Release requires a portable production artifact for ${target}` });
    identities.push([artifact.abi, artifact.revision, artifact.sourceDigest, artifact.cargoLockDigest].join(':'));
  }
  if (identities[0] !== identities[1]) return yield* new ReleaseAssemblyFailed({ message: 'Native target source identities disagree' });
  const scratch = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-release-targets-' });
  const assets: string[] = [];
  for (const target of ['linux-x64', 'darwin-arm64'] as const) {
    const archive = yield* assembleArchive({ target, applicationRoot: application, nativeArtifacts: resolve(nativeArtifacts), outputRoot: join(scratch, target) });
    const name = basename(archive.filename);
    yield* fs.copyFile(archive.filename, join(output, name));
    assets.push(name);
  }
  const library = yield* packLibrary(output, application);
  assets.push(basename(library.filename));
  yield* verifyReleaseLibrary(library.filename);
  yield* fs.copyFile(resolve('install.sh'), join(output, 'install.sh'));
  assets.push('install.sh');
  const checksums: string[] = [];
  for (const name of assets.sort()) checksums.push(`${createHash('sha256').update(yield* fs.readFile(join(output, name))).digest('hex')}  ${name}`);
  yield* fs.writeFileString(join(output, 'SHA256SUMS'), `${checksums.join('\n')}\n`);
  return { assets, directory: output };
}, Effect.scoped);

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  Effect.gen(function*() {
    const args = yield* Schema.decodeUnknownEffect(Schema.Tuple([Schema.String, Schema.String, Schema.String]))(process.argv.slice(2));
    yield* Effect.tryPromise({ try: () => buildApplication(resolve(args[1])), catch: cause => new ReleaseAssemblyFailed({ message: String(cause) }) });
    const result = yield* assembleRelease(...args);
    yield* Effect.sync(() => process.stdout.write(`${JSON.stringify(result)}\n`));
  }).pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}
