// 跨进程保证：外部程序——性能场景驱动真实并发CLI结果并在失败后恢复冻结消费者。
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect, Schema } from 'effect';
import { loadArtifact } from '../../scripts/perf/artifact.ts';
import { commandGroups } from '../../scripts/perf/selection.ts';
import { executeScenario, makeContext, type BenchScenario } from '../../scripts/perf/scenario.ts';
import { fullCommand } from '../../src/entry/cli/cli-full.ts';
import { io, mustRun } from '../../scripts/perf/process.ts';
import { installedConcordCli } from '../support/support.ts';
import { prepareConsumer, workDirectory } from '../../scripts/perf/workspace.ts';
const root = resolve(".");
// @feature docs/feature/local-sdlc/README.md
test('real CLI help renders every top-level command definition', () => Effect.runPromise(Effect.gen(function*() {
  const work = yield* workDirectory('concord-coverage-', false);
  const artifact = yield* loadArtifact('candidate', root, installedConcordCli());
  const groups = yield* commandGroups(artifact.entry, root, work);
  assert.deepEqual(groups.sort(), fullCommand.subcommands.flatMap(group => group.commands.map(command => command.name)).sort());
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))));

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
    expect: { exitCode: 0, json: Schema.Struct({ operation: Schema.Literal('list'), documents: Schema.Array(Schema.Json), complete: Schema.Literal(true), findings: Schema.Array(Schema.Json) }) },
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
