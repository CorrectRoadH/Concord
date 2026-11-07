import assert from 'node:assert/strict';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema } from 'effect';
import { parse } from 'yaml';
import config from '../../concord.config.ts';

// @feature docs/engineering/testing/architecture.md
test('development and CI share the Node 26 declaration included in runner evidence', () => Effect.runPromise(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const declaration = yield* fs.readFileString('.node-version');
  assert.match(declaration, /^26\.\d+\.\d+\n$/u);
  assert.equal(process.versions.node, declaration.trim(), 'run acceptance with the declared Node version');
  assert.deepEqual(config.runner.sourceFiles.filter((path: string) => ['.node-version', 'package.json', 'pnpm-lock.yaml', 'tsconfig.test.json'].includes(path)).sort(), ['.node-version', 'package.json', 'pnpm-lock.yaml', 'tsconfig.test.json']);
  const Workflow = Schema.Struct({
    jobs: Schema.Record(Schema.String, Schema.Struct({
      steps: Schema.optional(Schema.Array(Schema.Struct({
        uses: Schema.optional(Schema.String),
        with: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
      }))),
      strategy: Schema.optional(Schema.Struct({ matrix: Schema.Record(Schema.String, Schema.Unknown) })),
    })),
  });
  const setups: string[] = [];
  for (const name of ['gate', 'native', 'release']) {
    const workflow = yield* Schema.decodeUnknownEffect(Workflow)(parse(yield* fs.readFileString(`.github/workflows/${name}.yml`)));
    for (const [jobName, job] of Object.entries(workflow.jobs)) {
      for (const step of job.steps ?? []) {
        if (step.uses !== 'actions/setup-node@v4') continue;
        assert.equal(step.with?.['node-version-file'], '.node-version', `${name}/${jobName}`);
        assert.equal(step.with?.['node-version'], undefined, `${name}/${jobName}: use the declaration as the only version owner`);
        setups.push(`${name}/${jobName}`);
      }
      if (name === 'gate') assert.deepEqual(job.strategy?.matrix, { shard: [...Array.from({ length: 16 }, (_, i) => `${i + 1}/16`), 'package'] });
    }
  }
  assert.deepEqual(setups.sort(), ['gate/gate', 'native/native', 'release/herdr-mod', 'release/native', 'release/package', 'release/verify']);
}).pipe(Effect.provide(NodeServices.layer))));
