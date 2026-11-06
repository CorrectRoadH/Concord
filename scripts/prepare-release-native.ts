// @concord-file
// @concord-implements docs/feature/cross-platform-release/use-case/release-from-tag.md
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema } from 'effect';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodeNativeArtifact } from '../src/base/installation/index.ts';
import { io, mustRun } from './perf/process.ts';

const Digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u));
const Asset = Schema.Struct({ asset: Schema.String.check(Schema.isPattern(/^ripgrep-[\w.+-]+\.tar\.gz$/u)), sha256: Digest });
const RuntimeDependencies = Schema.Struct({ ripgrep: Schema.Struct({ version: Schema.String, targets: Schema.Struct({ 'linux-x64': Asset, 'darwin-arm64': Asset }) }) });
class NativeReleaseInvalid extends Schema.TaggedError<NativeReleaseInvalid>()('NativeReleaseInvalid', { message: Schema.String }) {}

// @use-case docs/feature/cross-platform-release/use-case/release-from-tag.md#native
export const signDarwinReleaseNative = Effect.fn('release.signDarwinNative')(function*(artifacts: string, repository = process.cwd()) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') return yield* new NativeReleaseInvalid({ message: 'Darwin release signing requires an Apple Silicon host' });
  const fs = yield* FileSystem.FileSystem;
  const root = resolve(artifacts, 'darwin-arm64');
  const deps = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(RuntimeDependencies), { onExcessProperty: 'error' })(yield* fs.readFileString(join(repository, 'runtime-deps.json')));
  const config = deps.ripgrep.targets['darwin-arm64'];
  const scratch = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-release-sign-' });
  const options = { cwd: scratch, outputDir: scratch, timeoutMs: 120_000 };
  const archive = join(scratch, config.asset);
  yield* mustRun(['curl', '--fail', '--location', '--proto', '=https', '--tlsv1.2', '--output', archive, `https://github.com/BurntSushi/ripgrep/releases/download/${deps.ripgrep.version}/${config.asset}`], options);
  if (createHash('sha256').update(yield* fs.readFile(archive)).digest('hex') !== config.sha256) return yield* new NativeReleaseInvalid({ message: 'Official ripgrep archive checksum differs' });
  yield* mustRun(['tar', '-xzf', archive, '-C', scratch], options);
  const extracted = join(scratch, config.asset.replace(/\.tar\.gz$/u, ''));
  const metadataPath = join(root, 'artifact.json');
  const metadataText = yield* fs.readFileString(metadataPath);
  const metadata = yield* io('Decode native identity before signing', () => decodeNativeArtifact(JSON.parse(metadataText)));
  if (metadata.target !== 'darwin-arm64' || !metadata.portable || metadata.testHooks) return yield* new NativeReleaseInvalid({ message: 'Only a portable production Darwin native artifact can be signed' });
  const binary = join(root, 'hawdb.node');
  if (createHash('sha256').update(yield* fs.readFile(binary)).digest('hex') !== metadata.binarySha256) return yield* new NativeReleaseInvalid({ message: 'Native binary checksum differs before signing' });
  yield* fs.copyFile(join(extracted, 'rg'), join(root, 'rg'));
  for (const name of ['LICENSE-MIT', 'COPYING']) yield* fs.copyFile(join(extracted, name), join(root, name));
  for (const file of [binary, join(root, 'rg')]) {
    yield* mustRun(['codesign', '--force', '--sign', '-', file], options);
    yield* mustRun(['codesign', '--verify', '--strict', file], options);
  }
  yield* fs.writeFileString(metadataPath, `${JSON.stringify({ ...metadata, binarySha256: createHash('sha256').update(yield* fs.readFile(binary)).digest('hex') }, null, 2)}\n`);
  yield* fs.writeFileString(join(root, 'rg-runtime.json'), `${JSON.stringify({ format: 'concord.signed-rg/v1', target: 'darwin-arm64', version: deps.ripgrep.version, asset: config.asset, upstreamSha256: config.sha256, binarySha256: createHash('sha256').update(yield* fs.readFile(join(root, 'rg'))).digest('hex') }, null, 2)}\n`);
}, Effect.scoped);

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  signDarwinReleaseNative(process.argv[2] ?? 'native-artifacts').pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}
