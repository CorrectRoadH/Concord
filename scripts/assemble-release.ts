// @concord-file
// @concord-implements docs/feature/cross-platform-release/use-case/release-from-tag.md
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema } from 'effect';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assembleArchive, nativeTarget } from './archive.ts';
import { archiveTarget, command, readJson, sha256, Target, type ArchiveTarget } from './archive-support.ts';
import { assertCompilationHost, compilationTarget } from './compile-application.ts';
import { BuildIdentity } from './build-identity.ts';
import { NativeArtifactSchema } from '../src/base/installation/hawdb-native-contract.ts';

class ReleaseAssemblyFailed extends Schema.TaggedError<ReleaseAssemblyFailed>()('ReleaseAssemblyFailed', { message: Schema.String }) {}
const Digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u));
const Commit = Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/u));
const Package = Schema.Struct({ version: Schema.String, gitHead: Commit });
const Compiler = Schema.Struct({ version: Schema.String, revision: Schema.String, binarySha256: Digest, target: Target, cpu: Schema.String });
const emptyOutput = Effect.fn('release.emptyOutput')(function*(destination: string) {
  const fs = yield* FileSystem.FileSystem;
  const output = resolve(destination);
  if (yield* fs.exists(output)) {
    if ((yield* fs.readDirectory(output)).length !== 0) return yield* new ReleaseAssemblyFailed({ message: 'Release output must be empty' });
  } else yield* fs.makeDirectory(output, { recursive: true });
  return output;
});
const writeChecksums = Effect.fn('release.checksums')(function*(output: string, assets: readonly string[]) {
  const fs = yield* FileSystem.FileSystem;
  const checksums: string[] = [];
  for (const name of [...assets].sort()) checksums.push(`${sha256(yield* fs.readFile(join(output, name)))}  ${name}`);
  yield* fs.writeFileString(join(output, 'SHA256SUMS'), `${checksums.join('\n')}\n`);
});

/** One candidate per target host. No host may rebuild another target's bytecode. */
// @use-case docs/feature/cross-platform-release/use-case/release-from-tag.md#package
export const assembleRelease = Effect.fn('release.assemble')(function*(destination: string, applicationRoot: string, nativeArtifacts: string, target: ArchiveTarget = archiveTarget()) {
  yield* Effect.try({ try: () => assertCompilationHost(target), catch: cause => cause });
  const fs = yield* FileSystem.FileSystem;
  const output = yield* emptyOutput(destination);
  const artifact = yield* readJson(resolve(nativeArtifacts, nativeTarget(target), 'artifact.json'), NativeArtifactSchema);
  if (artifact.target !== nativeTarget(target) || !artifact.portable || artifact.testHooks) return yield* new ReleaseAssemblyFailed({ message: `Release requires a portable production artifact for ${target}` });
  const scratch = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-release-target-' });
  const archive = yield* assembleArchive({ target, applicationRoot: resolve(applicationRoot), nativeArtifacts: resolve(nativeArtifacts), outputRoot: join(scratch, target) });
  const name = basename(archive.filename);
  yield* fs.copyFile(archive.filename, join(output, name));
  yield* writeChecksums(output, [name]);
  return { target, assets: [name], directory: output };
}, Effect.scoped);

const archiveJson = <S extends Schema.Top>(archive: string, member: string, schema: S) => command('tar', ['-xOzf', archive, member]).pipe(
  Effect.flatMap(text => Schema.decodeUnknownEffect(Schema.fromJsonString(schema), { onExcessProperty: 'ignore' })(text)),
);

/** Read metadata without extracting or executing candidate code on this host. */
// @use-case docs/feature/cross-platform-release/use-case/release-from-tag.md#package
export const collectRelease = Effect.fn('release.collect')(function*(destination: string, candidates: readonly string[], repository = resolve(import.meta.dirname, '..')) {
  const fs = yield* FileSystem.FileSystem;
  const inputs: { path: string; name: string; target: ArchiveTarget; version: string; commit: string; native: string; bun: string }[] = [];
  const pinned = (yield* fs.readFileString(join(repository, '.bun-version'))).trim();
  for (const directory of candidates) {
    const folder = resolve(directory);
    const names = (yield* fs.readDirectory(folder)).filter(name => /^concord-.+-(?:linux-x64|darwin-arm64)\.tar\.gz$/u.test(name));
    if (names.length !== 1) return yield* new ReleaseAssemblyFailed({ message: `Expected one target candidate: ${folder}` });
    const name = names[0]!, path = join(folder, name);
    const target = archiveTarget(name.endsWith('-linux-x64.tar.gz') ? 'linux-x64' : 'darwin-arm64');
    const digest = sha256(yield* fs.readFile(path));
    if ((yield* fs.readFileString(join(folder, 'SHA256SUMS'))).trim() !== `${digest}  ${name}`) return yield* new ReleaseAssemblyFailed({ message: `Candidate checksum differs: ${name}` });
    const pkg = yield* archiveJson(path, 'app/package.json', Package);
    const identity = yield* archiveJson(path, 'app/dist/build-identity.json', BuildIdentity);
    const compiler = yield* archiveJson(path, 'app/dist/compiler.json', Compiler);
    const native = yield* archiveJson(path, `app/dist/native/${nativeTarget(target)}/artifact.json`, NativeArtifactSchema);
    if (name !== `concord-${pkg.version}-${target}.tar.gz` || pkg.gitHead !== identity.commit
      || process.env.RELEASE_COMMIT !== undefined && pkg.gitHead !== process.env.RELEASE_COMMIT
      || compiler.target !== target || compiler.cpu !== compilationTarget(target) || compiler.version !== pinned
      || native.target !== nativeTarget(target) || !native.portable || native.testHooks) {
      return yield* new ReleaseAssemblyFailed({ message: `Candidate identity differs: ${name}` });
    }
    inputs.push({ path, name, target, version: pkg.version, commit: pkg.gitHead, bun: compiler.revision,
      native: [native.abi, native.revision, native.sourceDigest, native.cargoLockDigest].join(':') });
  }
  if (inputs.length !== 2 || new Set(inputs.map(input => input.target)).size !== 2) return yield* new ReleaseAssemblyFailed({ message: 'Release requires exactly one candidate for each supported target' });
  if (new Set(inputs.map(input => [input.version, input.commit, input.bun, input.native].join(':'))).size !== 1) return yield* new ReleaseAssemblyFailed({ message: 'Candidate source identities disagree' });
  const output = yield* emptyOutput(destination);
  const assets = inputs.map(input => input.name);
  for (const input of inputs) yield* fs.copyFile(input.path, join(output, input.name));
  yield* fs.copyFile(join(repository, 'install.sh'), join(output, 'install.sh'));
  assets.push('install.sh');
  yield* writeChecksums(output, assets);
  return { assets, directory: output };
});

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  Effect.gen(function*() {
    const [mode, ...args] = process.argv.slice(2);
    let result;
    if (mode === 'candidate') {
      const [output, application, native] = yield* Schema.decodeUnknownEffect(Schema.Tuple([Schema.String, Schema.String, Schema.String]))(args);
      assertCompilationHost(archiveTarget());
      const { buildApplication } = yield* Effect.promise(() => import('./distribution.ts'));
      yield* Effect.tryPromise({ try: () => buildApplication(resolve(application)), catch: cause => new ReleaseAssemblyFailed({ message: String(cause) }) });
      result = yield* assembleRelease(output, application, native);
    } else if (mode === 'collect') {
      const [output, linux, darwin] = yield* Schema.decodeUnknownEffect(Schema.Tuple([Schema.String, Schema.String, Schema.String]))(args);
      result = yield* collectRelease(output, [linux, darwin]);
    } else return yield* new ReleaseAssemblyFailed({ message: 'Usage: assemble-release.ts candidate <output> <application> <native-artifacts> | collect <output> <linux-candidate> <darwin-candidate>' });
    yield* Effect.sync(() => process.stdout.write(`${JSON.stringify(result)}\n`));
  }).pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}
