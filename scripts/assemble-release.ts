// @concord-file
// @concord-implements docs/feature/cross-platform-release/use-case/release-from-tag.md
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema } from 'effect';
import { createHash } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assembleArchive } from './archive.ts';
import { buildApplication } from './distribution.ts';
import { io, mustRun } from './perf/process.ts';
import { decodeNativeArtifact } from '../src/base/installation/index.ts';

class ReleaseAssemblyFailed extends Schema.TaggedError<ReleaseAssemblyFailed>()('ReleaseAssemblyFailed', { message: Schema.String }) {}

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
