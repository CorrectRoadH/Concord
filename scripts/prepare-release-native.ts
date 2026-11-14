// @concord-file
// @concord-implements docs/feature/cross-platform-release/use-case/release-from-tag.md
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema } from 'effect';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyNativeArtifactDirectory } from '../src/base/installation/index.ts';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';

const Digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u));
const Asset = Schema.Struct({ asset: Schema.String.check(Schema.isPattern(/^ripgrep-[\w.+-]+\.tar\.gz$/u)), sha256: Digest });
const RuntimeDependencies = Schema.Struct({ ripgrep: Schema.Struct({ version: Schema.String, targets: Schema.Struct({ 'linux-x64': Asset, 'darwin-arm64': Asset }) }) });
class NativeReleaseInvalid extends Schema.TaggedError<NativeReleaseInvalid>()('NativeReleaseInvalid', { message: Schema.String }) {}

const runNativeTool = Effect.fn('release.nativeTool')(function*(argv: readonly [string, ...string[]], cwd: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const code = yield* spawner.exitCode(ChildProcess.make(argv[0], argv.slice(1), { cwd, stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' }));
  if (Number(code) !== 0) return yield* new NativeReleaseInvalid({ message: `${argv[0]} exited ${code}` });
}, Effect.scoped, Effect.timeout('120 seconds'));

// @use-case docs/feature/cross-platform-release/use-case/release-from-tag.md#native
export const signDarwinReleaseNative = Effect.fn('release.signDarwinNative')(function*(artifacts: string, repository = process.cwd()) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') return yield* new NativeReleaseInvalid({ message: 'Darwin release signing requires an Apple Silicon host' });
  const fs = yield* FileSystem.FileSystem;
  const metadataTarget = 'darwin-arm64';
  const root = resolve(artifacts, 'darwin-arm64');
  const deps = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(RuntimeDependencies), { onExcessProperty: 'error' })(yield* fs.readFileString(join(repository, 'runtime-deps.json')));
  const config = deps.ripgrep.targets['darwin-arm64'];
  const scratch = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-release-sign-' });
  const archive = join(scratch, config.asset);
  yield* runNativeTool(['curl', '--fail', '--location', '--proto', '=https', '--tlsv1.2', '--output', archive, `https://github.com/BurntSushi/ripgrep/releases/download/${deps.ripgrep.version}/${config.asset}`], scratch);
  if (createHash('sha256').update(yield* fs.readFile(archive)).digest('hex') !== config.sha256) return yield* new NativeReleaseInvalid({ message: 'Official ripgrep archive checksum differs' });
  yield* runNativeTool(['tar', '-xzf', archive, '-C', scratch], scratch);
  const extracted = join(scratch, config.asset.replace(/\.tar\.gz$/u, ''));
  const { binary } = yield* Effect.try({ try: () => verifyNativeArtifactDirectory(root, 'darwin-arm64'), catch: cause => new NativeReleaseInvalid({ message: String(cause) }) });
  const runtimeRoot = resolve(artifacts, 'runtime', metadataTarget);
  yield* fs.makeDirectory(runtimeRoot, { recursive: true });
  yield* fs.copyFile(join(extracted, 'rg'), join(runtimeRoot, 'rg'));
  for (const name of ['LICENSE-MIT', 'COPYING']) yield* fs.copyFile(join(extracted, name), join(runtimeRoot, name));
  yield* runNativeTool(['codesign', '--verify', '--strict', binary], scratch);
  for (const file of [join(runtimeRoot, 'rg')]) {
    yield* runNativeTool(['codesign', '--force', '--sign', '-', file], scratch);
    yield* runNativeTool(['codesign', '--verify', '--strict', file], scratch);
  }
  yield* fs.writeFileString(join(runtimeRoot, 'rg-runtime.json'), `${JSON.stringify({ format: 'concord.signed-rg/v1', target: 'darwin-arm64', version: deps.ripgrep.version, asset: config.asset, upstreamSha256: config.sha256, binarySha256: createHash('sha256').update(yield* fs.readFile(join(runtimeRoot, 'rg'))).digest('hex') }, null, 2)}\n`);
}, Effect.scoped);

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  signDarwinReleaseNative(process.argv[2] ?? 'native-artifacts').pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}
