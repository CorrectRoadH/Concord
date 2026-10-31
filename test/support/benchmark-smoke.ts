import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Effect } from 'effect';
import { loadArtifact } from '../../scripts/perf/artifact.js';
import { executeScenario, loadScenarios, makeContext, prepareServer } from '../../scripts/perf/scenario.js';
import { io, mustRun } from '../../scripts/perf/process.js';
import { prepareConsumer, workDirectory } from '../../scripts/perf/workspace.js';
import { installedConcordCli } from './support.js';

/** Inner consumers share the gate's process pool; bound their parallel work. */
export const benchmarkSmoke = Effect.fn('test.benchmarkSmoke')(function*(service: boolean) {
  const root = resolve('.');
  const started = performance.now();
  const trace = (label: string, since: number) => io('Trace smoke execution', () => { if (process.env.CONCORD_BENCH_SMOKE_TRACE === '1') process.stderr.write(`# smoke ${label}: ${(performance.now() - since).toFixed(0)}ms\n`); });
  const work = yield* workDirectory('concord-bench-smoke-', false), outputDir = join(work, 'runs');
  yield* io('Create smoke outputs', () => mkdirSync(outputDir));
  const artifact = yield* loadArtifact('candidate', root, installedConcordCli());
  const scenarios = (yield* loadScenarios(root)).filter(scenario => (scenario.server === 'running') === service);
  assert.ok(scenarios.length > 0);
  const folder = join(work, 'consumer'); yield* io('Create smoke consumer directory', () => mkdirSync(folder));
  const consumer = yield* prepareConsumer('fixture:smoke', { repository: root, entry: artifact.entry, commit: 'HEAD', scale: { sources: 1, tests: 1, pages: 1 }, workDir: folder, smoke: true });
  yield* trace('fixture', started);
  const features = [...new Set(scenarios.map(scenario => scenario.id.split('/')[0]!))];
  const groups = features.flatMap(feature => {
    const owned = scenarios.filter(scenario => scenario.id.startsWith(`${feature}/`));
    const size = feature === 'local-sdlc' ? 4 : feature === 'local-data-engine' ? 2 : owned.length;
    return Array.from({ length: Math.ceil(owned.length / size) }, (_, index) => ({ name: `${feature}-${index}`, scenarios: owned.slice(index * size, (index + 1) * size) }));
  });
  groups.sort((a, b) => Number(b.name.startsWith('web-workbench-')) - Number(a.name.startsWith('web-workbench-')));
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
