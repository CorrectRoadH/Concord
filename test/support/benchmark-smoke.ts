import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Effect } from 'effect';
import { loadArtifact } from '../../scripts/perf/artifact.ts';
import { executeScenario, loadScenarios, makeContext, prepareServer, type BenchScenario } from '../../scripts/perf/scenario.ts';
import { io, mustRun } from '../../scripts/perf/process.ts';
import { prepareConsumer, workDirectory } from '../../scripts/perf/workspace.ts';
import { installedConcordCli } from './support.ts';

export function benchmarkSmokeGroups(scenarios: readonly BenchScenario[], service: boolean, feature: string, indices?: readonly number[]) {
  const owned = scenarios.filter(scenario => (scenario.server === 'running') === service && scenario.id.startsWith(`${feature}/`));
  assert.ok(owned.length > 0, `No ${service ? 'service' : 'ordinary'} smoke scenarios for ${feature}`);
  const size = feature === 'local-sdlc' ? 4 : feature === 'local-data-engine' || feature === 'web-workbench' ? 2 : owned.length;
  const groups = Array.from({ length: Math.ceil(owned.length / size) }, (_, index) => ({
    name: `${feature}-${index}`, scenarios: owned.slice(index * size, (index + 1) * size),
  }));
  if (indices === undefined) return groups;
  assert.ok(indices.length > 0, `No smoke groups selected for ${feature}`);
  assert.equal(new Set(indices).size, indices.length, `Duplicate smoke groups for ${feature}`);
  for (const index of indices) assert.ok(Number.isInteger(index) && index >= 0 && index < groups.length, `Unknown smoke group ${feature}-${index}`);
  return groups.filter((_, index) => indices.includes(index));
}

/** Each file owns its frozen consumers; bound parallel work inside that file too. */
export const benchmarkSmoke = Effect.fn('test.benchmarkSmoke')(function*(service: boolean, feature: string, indices?: readonly number[]) {
  const root = resolve('.');
  const started = performance.now();
  const trace = (label: string, since: number) => io('Trace smoke execution', () => { if (process.env.CONCORD_BENCH_SMOKE_TRACE === '1') process.stderr.write(`# smoke ${label}: ${(performance.now() - since).toFixed(0)}ms\n`); });
  const groups = benchmarkSmokeGroups(yield* loadScenarios(root), service, feature, indices);
  const work = yield* workDirectory('concord-bench-smoke-', false), outputDir = join(work, 'runs');
  yield* io('Create smoke outputs', () => mkdirSync(outputDir));
  const artifact = yield* loadArtifact('candidate', root, installedConcordCli());
  const folder = join(work, 'consumer'); yield* io('Create smoke consumer directory', () => mkdirSync(folder));
  const consumer = yield* prepareConsumer('fixture:smoke', { repository: root, entry: artifact.entry, commit: 'HEAD', scale: { sources: 1, tests: 1, pages: 1 }, workDir: folder, smoke: true });
  yield* trace('fixture', started);
  yield* Effect.forEach(groups, group => Effect.gen(function*() {
    const groupStarted = performance.now();
    const directory = join(work, group.name); yield* io('Create independent smoke cache directory', () => mkdirSync(directory));
    const isolated = yield* prepareConsumer('self', { repository: consumer.root, entry: artifact.entry, commit: consumer.commit, scale: { sources: 1, tests: 1, pages: 1 }, workDir: directory, smoke: true });
    yield* trace(`${group.name} ready`, groupStarted);
    const context = makeContext(artifact, isolated, outputDir, true);
    for (const scenario of group.scenarios) {
      if (scenario.server === 'running') yield* prepareServer(context);
      yield* Effect.scoped(Effect.gen(function*() {
        if (scenario.prepare) yield* scenario.prepare(context);
        yield* executeScenario(scenario, context);
      }));
    }
    const status = yield* mustRun(['git', 'status', '--porcelain'], { cwd: isolated.root, outputDir });
    assert.equal(status.stdout.trim(), '', `${group.name} changed its frozen consumer`);
    yield* trace(`${group.name} done`, groupStarted);
  }).pipe(Effect.scoped), { concurrency: 2 });

});
