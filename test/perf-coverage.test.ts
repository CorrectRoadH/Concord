import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { loadArtifact } from '../scripts/perf/artifact.js';
import { loadBudgets } from '../scripts/perf/budgets.js';
import { commandGroups, selectScenarios } from '../scripts/perf/selection.js';
import { executeScenario, loadScenarios, makeContext, runArguments, type BenchScenario } from '../scripts/perf/scenario.js';
import { io, mustRun } from '../scripts/perf/process.js';
import { prepareConsumer, workDirectory } from '../scripts/perf/workspace.js';
const root = resolve('.');
// @feature docs/feature/local-sdlc/README.md
test('performance budgets and executable scenarios have exactly one consistent owner', () => Effect.runPromise(Effect.gen(function*() {
  const scenarios = yield* loadScenarios(root), budgets = yield* loadBudgets(root);
  const ids = scenarios.map(s => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const row of budgets) for (const id of row.scenarios) { assert.ok(ids.includes(id), `Missing scenario ${id}`); assert.equal(id.split('/')[0], row.featureId); }
  for (const id of ids) assert.equal(budgets.filter(row => row.scenarios.includes(id)).length, 1, id);
  assert.deepEqual(selectScenarios(scenarios, ['local-sdlc']).map(s => s.id), ids.filter(id => id.startsWith('local-sdlc/')));
  assert.equal(selectScenarios(scenarios, [], { files: ['scripts/perf/stats.ts'], features: [] }).length, ids.length);
  assert.deepEqual(selectScenarios(scenarios, [], { files: ['bench/feedback.bench.ts'], features: [] }).map(s => s.id), ['feedback/list']);
  assert.throws(() => selectScenarios(scenarios, ['absent']));
})));
// @feature docs/feature/local-sdlc/README.md
test('CLI top-level command definitions have scenarios or documented exemptions', () => Effect.runPromise(Effect.gen(function*() {
  const work = yield* workDirectory('concord-coverage-', false);
  const artifact = yield* loadArtifact('candidate', root);
  const groups = yield* commandGroups(artifact.entry, root, work);
  const scenarios = yield* loadScenarios(root);
  const policy = readFileSync(join(root, 'docs/engineering/concord-self-hosting/performance.md'), 'utf8');
  const exemptions = [...policy.matchAll(/^\| ((?:`[^`]+`[、 ]*)+) \| ([^|]+) \|$/gmu)].flatMap(match => [...match[1]!.matchAll(/`([^`]+)`/gu)].map(item => item[1]!));
  const covered = scenarios.map(s => runArguments(s.run).find(arg => !arg.startsWith('--')));
  for (const group of groups) assert.ok(covered.includes(group) || exemptions.includes(group), `Uncovered CLI command group: ${group}`);
}).pipe(Effect.scoped)));
// @feature docs/feature/local-sdlc/README.md
test('all benchmark scenarios execute on minimal frozen consumers without timing verdicts', { timeout: 30000 }, t => Effect.runPromise(Effect.gen(function*() {
  const started = performance.now();
  const trace = (label: string, since: number) => io('Trace smoke execution', () => { if (process.env.CONCORD_BENCH_SMOKE_TRACE === '1') process.stderr.write(`# smoke ${label}: ${(performance.now() - since).toFixed(0)}ms\n`); });
  const work = yield* workDirectory('concord-bench-smoke-', false), outputDir = join(work, 'runs');
  yield* io('Create smoke outputs', () => mkdirSync(outputDir));
  const artifact = yield* loadArtifact('candidate', root), scenarios = yield* loadScenarios(root);
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
      if (scenario.prepare) yield* scenario.prepare(context);
      yield* executeScenario(scenario, context);
    }
    const status = yield* mustRun(['git', 'status', '--porcelain'], { cwd: isolated.root, outputDir });
    assert.equal(status.stdout.trim(), '', `${group.name} changed its frozen consumer`);
    yield* trace(`${group.name} done`, groupStarted);
  }), { concurrency: 8 });

}).pipe(Effect.scoped), { signal: t.signal }));

// @feature docs/feature/local-sdlc/README.md
test('scenario execution checks every concurrent result and restores beforeEach edits on failure', () => Effect.runPromise(Effect.gen(function*() {
  const work = yield* workDirectory('concord-scenario-lifecycle-', false);
  const artifact = yield* loadArtifact('candidate', root);
  const consumer = yield* prepareConsumer('fixture:minimal', { repository: root, entry: artifact.entry, commit: 'HEAD', scale: { sources: 1, tests: 1, pages: 1 }, workDir: work, smoke: true });
  const context = makeContext(artifact, consumer, work, true);
  const source = join(consumer.root, 'src/file-0.ts'), transient = join(consumer.root, 'src/transient.ts');
  const original = readFileSync(source, 'utf8');
  const scenario: BenchScenario = {
    id: 'local-sdlc/lifecycle-fixture', consumer: 'fixture:minimal', state: 'warm',
    beforeEach: () => io('Change fixture sources', () => { writeFileSync(source, `${original}\n// changed before sample\n`); writeFileSync(transient, '// transient fixture\n'); }),
    run: { argv: ['--json', 'feature', 'list'], concurrency: 2 },
    expect: { exitCode: 0, json: Schema.Struct({ operation: Schema.Literal('feature-list'), documents: Schema.Array(Schema.Json) }) },
  };
  yield* executeScenario(scenario, context);
  const rejected = yield* Effect.result(executeScenario({ ...scenario, expect: { exitCode: 42 } }, context));
  assert.equal(rejected._tag, 'Failure');
  const invalidJson = yield* Effect.result(executeScenario({ ...scenario, expect: { exitCode: 0, json: Schema.Struct({ wrong: Schema.Literal(true) }) } }, context));
  assert.equal(invalidJson._tag, 'Failure');
  assert.equal(readFileSync(source, 'utf8'), original);
  assert.equal(existsSync(transient), false);
  const status = yield* mustRun(['git', 'status', '--porcelain'], { cwd: consumer.root, outputDir: work });
  assert.equal(status.stdout.trim(), '');
  const cold = yield* executeScenario({ id: 'local-sdlc/cold-fixture', consumer: 'fixture:minimal', state: 'cold', run: ['--json', 'cache', 'status'], expect: { exitCode: 0 } }, context);
  const decoded = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ status: Schema.String })), { onExcessProperty: 'ignore' })(cold.stdout);
  assert.notEqual(decoded.status, 'ready');
}).pipe(Effect.scoped)));
