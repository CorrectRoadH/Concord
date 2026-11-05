import { mkdirSync, readFileSync, readdirSync, existsSync, writeFileSync, utimesSync, unlinkSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { Effect, Schema } from 'effect';
import { packageBin } from '../package-location.js';
import { loadArtifact } from './artifact.js';
import { io, mustRun, PerfError } from './process.js';
const Identity = Schema.Struct({ format: Schema.Literal('concord.bench-baseline/v1'), commit: Schema.String, digest: Schema.String, node: Schema.String });
export const prepareBaseline = Effect.fn('perf.prepareBaseline')(function*(repository: string, revision: string, outputDir: string) {
  const commit = (yield* mustRun(['git', 'rev-parse', '--verify', `${revision}^{commit}`], { cwd: repository, outputDir })).stdout.trim();
  const cache = resolve(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'concord/bench/baseline');
  const folder = join(cache, commit), built = join(cache, `${commit}-package`), marker = join(cache, `${commit}.json`);
  yield* io('Create baseline cache', () => mkdirSync(cache, { recursive: true }));
  if (yield* io('Find baseline identity', () => existsSync(marker))) {
    const saved = yield* io('Decode baseline identity', () => Schema.decodeUnknownSync(Schema.fromJsonString(Identity), { onExcessProperty: 'error' })(readFileSync(marker, 'utf8')));
    const artifact = yield* loadArtifact('baseline', folder, existsSync(join(built, 'package.json')) ? packageBin(built) : undefined);
    if (saved.commit !== commit || artifact.commit !== commit || saved.digest !== artifact.digest || saved.node !== process.version) return yield* new PerfError({ message: `Cached baseline identity mismatch: ${folder}` });
    const status = (yield* mustRun(['git', 'status', '--porcelain', '--untracked-files=no'], { cwd: folder, outputDir })).stdout.trim();
    if (status !== '') return yield* new PerfError({ message: `Cached baseline has modified sources: ${folder}` });
    yield* io('Touch reused baseline', () => { const now = new Date(); utimesSync(marker, now, now); });
    yield* pruneBaselines(repository, cache, commit, outputDir);
    return { ...artifact, dirty: false };
  }
  if (yield* io('Find incomplete baseline', () => existsSync(folder))) {
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
  const external = yield* io('Inspect baseline build contract', () => existsSync(join(folder, 'scripts/build-output.ts')));
  yield* mustRun(['pnpm', 'exec', 'vp', 'build', ...(external ? ['--outDir', built] : [])], { cwd: folder, outputDir });
  if (external) yield* mustRun(['pnpm', 'install', '--prod', '--frozen-lockfile', '--ignore-scripts', '--offline'], { cwd: built, outputDir });
  const artifact = yield* loadArtifact('baseline', folder, external ? packageBin(built) : undefined);
  if (artifact.commit !== commit || artifact.dirty) return yield* new PerfError({ message: 'Baseline source identity changed while building' });
  yield* io('Publish baseline identity', () => writeFileSync(marker, `${JSON.stringify({ format: 'concord.bench-baseline/v1', commit, digest: artifact.digest, node: process.version })}\n`));
  yield* pruneBaselines(repository, cache, commit, outputDir);
  return artifact;
});
const pruneBaselines = Effect.fn('perf.pruneBaselines')(function*(repository: string, cache: string, current: string, outputDir: string) {
  const { statSync } = yield* Effect.promise(() => import('node:fs'));
  const entries = yield* io('Inventory baseline cache', () => readdirSync(cache).filter(name => /^[a-f0-9]{40}$/u.test(name) && existsSync(join(cache, `${name}.json`)))
    .sort((a,b) => a === current ? -1 : b === current ? 1 : statSync(join(cache,`${b}.json`)).mtimeMs - statSync(join(cache,`${a}.json`)).mtimeMs));
  for (const name of entries.slice(3)) {
    // Remove only clean, validated managed clones. Never force unknown edits away.
    const root = join(cache, name);
    yield* io('Remove managed marker', () => {
      const saved = Schema.decodeUnknownSync(Schema.fromJsonString(Identity), { onExcessProperty: 'error' })(readFileSync(join(cache,`${name}.json`),'utf8'));
      if (saved.commit !== name) throw new Error('Invalid baseline cache owner');
    });
    const status = (yield* mustRun(['git', 'status', '--porcelain', '--untracked-files=no'], { cwd: root, outputDir })).stdout.trim();
    if (status) return yield* new PerfError({ message: `Retired baseline has source changes: ${root}` });
    yield* io('Remove retired managed clone', () => rmSync(root, { recursive: true, force: true }));
    yield* io('Remove retired baseline identity', () => { unlinkSync(join(cache, `${name}.json`)); rmSync(join(cache, `${name}-package`), { recursive: true, force: true }); });
  }
});
