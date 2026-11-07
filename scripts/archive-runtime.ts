import { join } from 'node:path';
import { Effect, FileSystem, Schema } from 'effect';
import { ArchiveFailed, readJson, run, sha256, verifiedDownload, type ArchiveTarget } from './archive-support.ts';
import { prepareBunLicenses } from './bun-licenses.ts';

const Asset = Schema.Struct({ asset: Schema.String.check(Schema.isPattern(/^ripgrep-[0-9.]+-(?:x86_64-unknown-linux-musl|aarch64-apple-darwin)\.tar\.gz$/u)), sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)) });
export const RuntimeDependencies = Schema.Struct({ ripgrep: Schema.Struct({ version: Schema.String.check(Schema.isPattern(/^\d+\.\d+\.\d+$/u)), targets: Schema.Struct({ 'linux-x64': Asset, 'darwin-arm64': Asset }) }) });
export const SignedRipgrep = Schema.Struct({
  format: Schema.Literal('concord.signed-rg/v1'), target: Schema.Literal('darwin-arm64'),
  version: Schema.String, asset: Schema.String, upstreamSha256: Schema.String, binarySha256: Schema.String,
});
export const runtimeDependencies = (repository: string) => readJson(join(repository, 'runtime-deps.json'), RuntimeDependencies);

export const prepareRuntime = Effect.fn('archive.runtime')(function*(root: string, repository: string, target: ArchiveTarget, nativeArtifacts?: string) {
  const fs = yield* FileSystem.FileSystem;
  const version = (yield* fs.readFileString(join(repository, '.bun-version'))).trim();
  yield* Schema.decodeUnknownEffect(Schema.String.check(Schema.isPattern(/^\d+\.\d+\.\d+$/u)))(version);
  const scratch = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-runtime-' });
  yield* fs.makeDirectory(join(root, 'runtime'), { recursive: true });
  yield* fs.makeDirectory(join(root, 'licenses'), { recursive: true });
  yield* prepareBunLicenses(root, version);
  const { ripgrep } = yield* runtimeDependencies(repository);
  const rg = ripgrep.targets[target];
  if (target === 'darwin-arm64') {
    if (!nativeArtifacts) return yield* new ArchiveFailed({ message: 'Darwin requires signed rg from the native job' });
    const folder = join(nativeArtifacts, target);
    const signed = yield* readJson(join(folder, 'rg-runtime.json'), SignedRipgrep);
    if (signed.version !== ripgrep.version || signed.asset !== rg.asset || signed.upstreamSha256 !== rg.sha256 || signed.binarySha256 !== sha256(yield* fs.readFile(join(folder, 'rg')))) {
      return yield* new ArchiveFailed({ message: 'Signed ripgrep identity mismatch' });
    }
    yield* fs.copyFile(join(folder, 'rg'), join(root, 'runtime/rg'));
    for (const license of ['COPYING', 'LICENSE-MIT']) yield* fs.copyFile(join(folder, license), join(root, `licenses/RIPGREP-${license}`));
    yield* fs.copyFile(join(folder, 'rg-runtime.json'), join(root, 'runtime/rg-runtime.json'));
  } else {
    const downloaded = yield* verifiedDownload(`https://github.com/BurntSushi/ripgrep/releases/download/${ripgrep.version}/${rg.asset}`, rg.sha256);
    const directory = rg.asset.replace(/\.tar\.gz$/u, '');
    yield* run('tar', ['-xzf', downloaded, '-C', scratch, `${directory}/rg`, `${directory}/COPYING`, `${directory}/LICENSE-MIT`]);
    yield* fs.copyFile(join(scratch, directory, 'rg'), join(root, 'runtime/rg'));
    for (const license of ['COPYING', 'LICENSE-MIT']) yield* fs.copyFile(join(scratch, directory, license), join(root, `licenses/RIPGREP-${license}`));
  }
  yield* fs.chmod(join(root, 'runtime/rg'), 0o755);
});
