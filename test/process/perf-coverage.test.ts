import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect, Schema } from 'effect';
import { loadArtifact } from '../../scripts/perf/artifact.ts';
import { loadBudgets } from '../../scripts/perf/budgets.ts';
import { commandGroups, selectScenarios } from '../../scripts/perf/selection.ts';
import { executeScenario, loadScenarios, makeContext, prepareServer, runArguments, type BenchScenario } from '../../scripts/perf/scenario.ts';
import { io, mustRun } from '../../scripts/perf/process.ts';
import { installedConcordCli } from '../support/support.ts';
import { prepareConsumer, workDirectory } from '../../scripts/perf/workspace.ts';
import { benchmarkSmoke } from '../support/benchmark-smoke.ts';
const root = resolve(".");
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
}).pipe(Effect.provide(NodeServices.layer))));
// @feature docs/feature/local-sdlc/README.md
test('CLI top-level command definitions have scenarios or documented exemptions', () => Effect.runPromise(Effect.gen(function*() {
  const work = yield* workDirectory('concord-coverage-', false);
  const artifact = yield* loadArtifact('candidate', root, installedConcordCli());
  const groups = yield* commandGroups(artifact.entry, root, work);
  const scenarios = yield* loadScenarios(root);
  const policy = readFileSync(join(root, 'docs/engineering/performance/format.md'), 'utf8');
  const exemptions = [...policy.matchAll(/^\| ((?:`[^`]+`[、 ]*)+) \| ([^|]+) \|$/gmu)].flatMap(match => [...match[1]!.matchAll(/`([^`]+)`/gu)].map(item => item[1]!));
  const covered = scenarios.map(s => runArguments(s.run).find(arg => !arg.startsWith('--')));
  for (const group of groups) assert.ok(covered.includes(group) || exemptions.includes(group), `Uncovered CLI command group: ${group}`);
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))));
// @feature docs/feature/local-sdlc/README.md
test('all ordinary benchmark scenarios execute on minimal frozen consumers without timing verdicts', { timeout: 180_000 }, t =>
  Effect.runPromise(benchmarkSmoke(false).pipe(Effect.scoped, Effect.provide(NodeServices.layer)), { signal: t.signal }));


// @feature docs/feature/local-sdlc/README.md
test('scenario execution checks every concurrent result and restores beforeEach edits on failure', () => Effect.runPromise(Effect.gen(function*() {
  const work = yield* workDirectory('concord-scenario-lifecycle-', false);
  const artifact = yield* loadArtifact('candidate', root, installedConcordCli());
  const consumer = yield* prepareConsumer('fixture:minimal', { repository: root, entry: artifact.entry, commit: 'HEAD', scale: { sources: 1, tests: 1, pages: 1 }, workDir: work, smoke: true });
  const context = makeContext(artifact, consumer, work, true);
  const source = join(consumer.root, 'src/file-0.ts'), transient = join(consumer.root, 'src/transient.ts');
  const original = readFileSync(source, 'utf8');
  const scenario: BenchScenario = {
    id: 'local-sdlc/lifecycle-fixture', consumer: 'fixture:minimal', state: 'warm',
    beforeEach: () => io('Change fixture sources', () => { writeFileSync(source, `${original}\n// changed before sample\n`); writeFileSync(transient, '// transient fixture\n'); }),
    run: { argv: ['--json', 'list', 'feature'], concurrency: 2 },
    expect: { exitCode: 0, json: Schema.Struct({ operation: Schema.Literal('list'), documents: Schema.Array(Schema.Json) }) },
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
  const coldCommands: (readonly string[])[] = [];
  const cold = yield* executeScenario({
    id: 'local-sdlc/cold-fixture', consumer: 'fixture:minimal', state: 'cold',
    beforeEach: () => Effect.sync(() => assert.deepEqual(coldCommands, [['cache', 'clear']])),
    run: ['--json', 'cache', 'status'], expect: { exitCode: 0 },
  }, {
    ...context,
    cli: (argv, timeoutMs) => context.cli(argv[0] === 'cache' && argv[1] === 'clear' ? [...argv, '--json'] : argv, timeoutMs).pipe(Effect.tap(result => Effect.sync(() => {
      coldCommands.push(argv);
      if (argv[0] === 'cache' && argv[1] === 'clear') {
        assert.equal(result.exitCode, 0, result.stderr);
        Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ status: Schema.Literals(['cleared', 'empty']) })))(result.stdout);
      }
    }))),
  });
  const decoded = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ status: Schema.String })), { onExcessProperty: 'ignore' })(cold.stdout);
  assert.deepEqual(coldCommands, [['cache', 'clear']]);
  assert.ok(['empty', 'ready'].includes(decoded.status), cold.stdout);
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))));
