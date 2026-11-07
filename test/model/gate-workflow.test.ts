import assert from 'node:assert/strict';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema } from 'effect';
import { parse } from 'yaml';

const Step = Schema.Struct({
  id: Schema.optional(Schema.String),
  if: Schema.optional(Schema.String),
  uses: Schema.optional(Schema.String),
  run: Schema.optional(Schema.String),
  with: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  'continue-on-error': Schema.optional(Schema.Boolean),
});
const Job = Schema.Struct({
  needs: Schema.optional(Schema.String),
  env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  outputs: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  strategy: Schema.optional(Schema.Struct({
    'fail-fast': Schema.Boolean,
    matrix: Schema.Struct({ shard: Schema.Array(Schema.String) }),
  })),
  steps: Schema.Array(Step),
});

// @feature docs/engineering/testing/README.md
test('CI builds production native once and requires isolated fault injection and every shard', () => Effect.runPromise(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const { jobs } = yield* Schema.decodeUnknownEffect(Schema.Struct({ jobs: Schema.Record(Schema.String, Job) }))(
    parse(yield* fs.readFileString('.github/workflows/gate.yml')),
  );
  assert.deepEqual(Object.keys(jobs).sort(), ['gate', 'native-hooks', 'prepare-native']);
  const prepare = jobs['prepare-native']!, gate = jobs.gate!, hooks = jobs['native-hooks']!;
  assert.equal(prepare.needs, undefined);
  assert.equal(gate.needs, 'prepare-native');
  assert.equal(hooks.needs, 'prepare-native');
  assert.equal(prepare.outputs?.sha, '${{ steps.revision.outputs.sha }}');
  assert.ok(prepare.steps.some(step => step.id === 'revision' && step.run?.includes('git rev-parse HEAD')));
  for (const job of [gate, hooks]) {
    assert.equal(job.steps.find(step => step.uses === 'actions/checkout@v4')?.with?.ref, '${{ needs.prepare-native.outputs.sha }}');
    assert.ok(job.steps.every(step => !step['continue-on-error']));
  }
  assert.equal(gate.strategy?.['fail-fast'], false);
  assert.deepEqual(gate.strategy?.matrix.shard, [...Array.from({ length: 16 }, (_, i) => `${i + 1}/16`), 'package']);
  const restore = prepare.steps.findIndex(step => step.uses === 'actions/cache/restore@v4');
  const validate = prepare.steps.findIndex(step => step.id === 'validated');
  const build = prepare.steps.findIndex(step => step.run?.includes('--reuse'));
  const save = prepare.steps.findIndex(step => step.uses === 'actions/cache/save@v4');
  const upload = prepare.steps.findIndex(step => step.uses === 'actions/upload-artifact@v4');
  assert.ok(restore >= 0 && restore < validate && validate < build && build < save && save < upload);
  assert.match(prepare.steps[validate]!.run!, /build-native.ts --prebuilt/u);
  assert.equal(prepare.steps[build]!.if, "steps.validated.outcome != 'success'");
  assert.equal(prepare.steps.find(step => step.uses === './.github/actions/setup-native')?.if, "steps.validated.outcome != 'success'");
  assert.equal(prepare.steps[restore]!.with?.key, '${{ steps.identity.outputs.key }}');
  assert.equal(prepare.steps[restore]!.with?.['restore-keys'], undefined);
  assert.equal(prepare.steps[save]!.with?.path, prepare.steps[restore]!.with?.path);
  const artifact = prepare.steps[upload]!.with?.name;
  assert.equal(artifact, 'gate-native');
  const download = gate.steps.findIndex(step => step.uses === 'actions/download-artifact@v4');
  const install = gate.steps.findIndex(step => step.run?.includes('build-native.ts --prebuilt'));
  const run = gate.steps.findIndex(step => step.run?.includes('pnpm gate --test-shard='));
  assert.ok(download >= 0 && download < install && install < run);
  assert.equal(gate.steps[download]!.with?.name, artifact);
  assert.doesNotMatch(gate.steps.map(step => `${step.uses ?? ''} ${step.run ?? ''}`).join('\n'), /setup-native|rustup|cargo|build:native|--reuse|--test-hooks/u);
  assert.equal(gate.steps.find(step => step.run?.includes('playwright install'))?.if, "matrix.shard != 'package'");
  assert.equal(hooks.env?.CONCORD_NATIVE_TEST_HOOKS, '1');
  const privateCache = hooks.steps.findIndex(step => step.run?.includes('XDG_CACHE_HOME=$RUNNER_TEMP/hawdb-hooks-cache'));
  assert.ok(privateCache >= 0 && privateCache < hooks.steps.findIndex(step => step.run?.includes('--test-hooks')));
  assert.match(hooks.steps[privateCache]!.run!, /GITHUB_ENV/u);
  assert.ok(hooks.steps.some(step => step.run === 'node scripts/build-native.ts --test-hooks'));
  assert.ok(hooks.steps.some(step => step.run === 'pnpm gate test/process/hawdb-native.test.ts'));
  assert.ok(hooks.steps.filter(step => step.uses?.includes('artifact@')).every(step => step.with?.path === '.test-results/'));
  assert.ok([gate, hooks].every(job => job.steps.some(step => step.uses === 'actions/upload-artifact@v4' && step.if === 'always()')));
}).pipe(Effect.provide(NodeServices.layer))));
