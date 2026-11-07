import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { Effect, FileSystem, Option, Schema } from 'effect';
import { packageBin } from '../package-location.ts';
import { loadArtifact } from './artifact.ts';
import { io, mustRun, PerfError } from './process.ts';
const Identity = Schema.Struct({ format: Schema.Literal('concord.bench-baseline/v1'), commit: Schema.String, digest: Schema.String, node: Schema.String });
export const prepareBaseline = Effect.fn('perf.prepareBaseline')(function*(repository: string, revision: string, outputDir: string) {
  const fs = yield* FileSystem.FileSystem;
  const commit = (yield* mustRun(['git', 'rev-parse', '--verify', `${revision}^{commit}`], { cwd: repository, outputDir })).stdout.trim();
  const cache = resolve(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'concord/bench/baseline');
  const folder = join(cache, commit), built = join(cache, `${commit}-package`), marker = join(cache, `${commit}.json`);
  yield* fs.makeDirectory(cache, { recursive: true });
  if (yield* fs.exists(marker)) {
    const bytes = yield* fs.readFileString(marker);
    const saved = yield* io('Decode baseline identity', () => Schema.decodeUnknownSync(Schema.fromJsonString(Identity), { onExcessProperty: 'error' })(bytes));
    const artifact = yield* loadArtifact('baseline', folder, yield* packageBin(built));
    if (saved.commit !== commit || artifact.commit !== commit || saved.digest !== artifact.digest || saved.node !== process.version) return yield* new PerfError({ message: `Cached baseline identity mismatch: ${folder}` });
    const status = (yield* mustRun(['git', 'status', '--porcelain', '--untracked-files=no'], { cwd: folder, outputDir })).stdout.trim();
    if (status !== '') return yield* new PerfError({ message: `Cached baseline has modified sources: ${folder}` });
    yield* fs.utimes(marker, new Date(), new Date());
    yield* pruneBaselines(repository, cache, commit, outputDir);
    return { ...artifact, dirty: false };
  }
  if (yield* fs.exists(folder)) {
    const revision = (yield* mustRun(['git', 'rev-parse', 'HEAD'], { cwd: folder, outputDir })).stdout.trim();
    const status = (yield* mustRun(['git', 'status', '--porcelain'], { cwd: folder, outputDir })).stdout.trim();
    const actual = (yield* mustRun(['git', 'remote', 'get-url', 'origin'], { cwd: folder, outputDir })).stdout.trim();
    const expected = repository;
    if (revision !== commit || status !== '' || actual !== expected) return yield* new PerfError({ message: `Incomplete baseline has unknown ownership or source changes: ${folder}` });
  } else {
    yield* mustRun(['git', 'clone', '--no-hardlinks', '--no-checkout', repository, folder], { cwd: repository, outputDir });
    yield* mustRun(['git', 'switch', '--detach', commit], { cwd: folder, outputDir });
  }
  const before = (yield* mustRun(['git', 'rev-parse', 'HEAD'], { cwd: folder, outputDir })).stdout.trim();
  if (before !== commit) return yield* new PerfError({ message: 'Baseline changed before build' });
  yield* mustRun(['pnpm', 'install', '--frozen-lockfile', '--offline'], { cwd: folder, outputDir });
  yield* mustRun(['pnpm', 'exec', 'vp', 'build', '--outDir', built], { cwd: folder, outputDir });
  const artifact = yield* loadArtifact('baseline', folder, yield* packageBin(built));
  if (artifact.commit !== commit || artifact.dirty) return yield* new PerfError({ message: 'Baseline source identity changed while building' });
  yield* fs.writeFileString(marker, `${JSON.stringify({ format: 'concord.bench-baseline/v1', commit, digest: artifact.digest, node: process.version })}\n`);
  yield* pruneBaselines(repository, cache, commit, outputDir);
  return artifact;
});
const pruneBaselines = Effect.fn('perf.pruneBaselines')(function*(repository: string, cache: string, current: string, outputDir: string) {
  const fs = yield* FileSystem.FileSystem;
  const candidates = (yield* fs.readDirectory(cache)).filter(name => /^[a-f0-9]{40}$/u.test(name));
  const inventory: { name: string; modified: number }[] = [];
  for (const name of candidates) {
    const marker = join(cache, `${name}.json`);
    if (yield* fs.exists(marker)) {
      const info = yield* fs.stat(marker);
      inventory.push({ name, modified: Option.getOrElse(info.mtime, () => new Date(0)).getTime() });
    }
  }
  const entries = inventory.sort((a, b) => a.name === current ? -1 : b.name === current ? 1 : b.modified - a.modified).map(item => item.name);
  for (const name of entries.slice(3)) {
    // Remove only clean, validated managed clones. Never force unknown edits away.
    const root = join(cache, name);
    const bytes = yield* fs.readFileString(join(cache, `${name}.json`));
    yield* io('Remove managed marker', () => {
      const saved = Schema.decodeUnknownSync(Schema.fromJsonString(Identity), { onExcessProperty: 'error' })(bytes);
      if (saved.commit !== name) throw new Error('Invalid baseline cache owner');
    });
    const status = (yield* mustRun(['git', 'status', '--porcelain', '--untracked-files=no'], { cwd: root, outputDir })).stdout.trim();
    if (status) return yield* new PerfError({ message: `Retired baseline has source changes: ${root}` });
    yield* fs.remove(root, { recursive: true, force: true });
    yield* fs.remove(join(cache, `${name}.json`));
    yield* fs.remove(join(cache, `${name}-package`), { recursive: true, force: true });
  }
});
