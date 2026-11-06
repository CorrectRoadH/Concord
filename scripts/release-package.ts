// @concord-file
// @concord-implements docs/feature/cross-platform-release/cli.md
// @concord-implements docs/feature/cross-platform-release/use-case/release-from-tag.md
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Effect, FileSystem, Schema } from 'effect';
import { io, mustRun, PerfError } from './perf/process.ts';

export const PackageArtifact = Schema.Struct({
  name: Schema.String, version: Schema.String, filename: Schema.String,
  files: Schema.Array(Schema.Struct({ path: Schema.String })),
});
export type PackedConcord = typeof PackageArtifact.Type;
const sourceRoot = fileURLToPath(new URL('..', import.meta.url));

// @use-case docs/feature/cross-platform-release/use-case/release-from-tag.md
export const packConcord = Effect.fn('packConcord')(function*(destination: string, repository = sourceRoot) {
  const fs = yield* FileSystem.FileSystem;
  const scratch = yield* fs.makeTempDirectoryScoped({ directory: tmpdir(), prefix: 'concord-release-pack-' });
  const options = { cwd: repository, outputDir: scratch };
  const output = yield* mustRun(['pnpm', '--config.ignore-scripts=true', 'pack', '--skip-manifest-obfuscation', '--json', '--pack-destination', scratch], { ...options, timeoutMs: 60_000 });
  const artifact = yield* io('Decode package artifact', () => Schema.decodeUnknownSync(Schema.fromJsonString(PackageArtifact))(output.stdout));
  yield* mustRun(['tar', '-xzf', resolve(scratch, artifact.filename), '-C', scratch], options);
  // pnpm pack 强制排除自己的锁；补入唯一原始锁，不能另生成与开发依赖图不同的发布锁。
  const manifestSchema = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown));
  const sourceManifest = yield* fs.readFileString(join(repository, 'package.json'));
  const packedManifest = yield* fs.readFileString(join(scratch, 'package/package.json'));
  yield* io('Verify packed package metadata', () => { if (!isDeepStrictEqual(Schema.decodeUnknownSync(manifestSchema)(sourceManifest), Schema.decodeUnknownSync(manifestSchema)(packedManifest))) throw new Error('pnpm changed package metadata'); });
  // pnpm 会移除 manifest 末尾换行；语义相同后恢复源字节，保持跨渠道身份。
  for (const name of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) yield* fs.copyFile(join(repository, name), join(scratch, 'package', name));
  for (const name of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
    const original = yield* fs.readFile(join(repository, name)), packed = yield* fs.readFile(join(scratch, 'package', name));
    if (!Buffer.from(original).equals(packed)) return yield* new PerfError({ message: `Packed identity differs: ${name}` });
  }
  yield* fs.makeDirectory(destination, { recursive: true });
  const filename = resolve(destination, `${artifact.name}-${artifact.version}.tgz`);
  // macOS 的扩展属性会生成 ._ 文件并破坏模板清单；归档只包含受管文件字节。
  yield* mustRun(['tar', '-czf', filename, '-C', scratch, 'package'], { ...options, env: { COPYFILE_DISABLE: '1' } });
  const listing = yield* mustRun(['tar', '-tzf', filename], options);
  const files = listing.stdout.trim().split('\n')
    .filter(path => !path.endsWith('/')).map(path => ({ path: path.replace(/^package\//u, '') }));
  return { ...artifact, filename, files };
}, Effect.scoped);

// Importers reuse the same packaging implementation without executing the CLI.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  Effect.gen(function*() {
    const { name, version, filename } = yield* packConcord(process.argv[2] ?? 'release', process.argv[3] ?? sourceRoot);
    process.stdout.write(`${JSON.stringify({ name, version, filename })}\n`);
  }).pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}

// Archive and independent library entrypoints share the legacy tar API module.
export { assembleArchive } from './archive.ts';
export { packLibrary } from './release-library.ts';
