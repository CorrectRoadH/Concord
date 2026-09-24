import assert from 'node:assert/strict';
import test from 'node:test';
import { join, resolve } from 'node:path';
import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { parse } from 'yaml';

const Workflow = Schema.Struct({
  on: Schema.Struct({ push: Schema.Struct({ tags: Schema.Array(Schema.String) }) }),
  jobs: Schema.Struct({ package: Schema.Struct({ steps: Schema.Array(Schema.Struct({
    name: Schema.optional(Schema.String), run: Schema.optional(Schema.String),
  })) }) }),
});

const Job = Schema.Struct({
  needs: Schema.optional(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  strategy: Schema.optional(Schema.Struct({ matrix: Schema.Struct({ shard: Schema.optional(Schema.Array(Schema.Number)) }) })),
  steps: Schema.Array(Schema.Struct({
    uses: Schema.optional(Schema.String),
    run: Schema.optional(Schema.String),
    with: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  })),
});

// @use-case docs/feature/cross-platform-release/use-case/release-from-tag.md
test('publication waits for all shards and platforms testing the single packed build', async () => {
  await Effect.runPromise(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const graph = yield* Schema.decodeUnknownEffect(Schema.Struct({ jobs: Schema.Record(Schema.String, Job) }))(
      parse(yield* fs.readFileString('.github/workflows/release.yml')),
    );
    const { package: pack, tests, portable, publish } = graph.jobs;
    assert.ok(pack && tests && portable && publish);
    assert.deepEqual(publish.needs, ['package', 'tests', 'portable']);
    assert.deepEqual(tests.strategy?.matrix.shard, [1, 2, 3, 4]);
    assert.ok(pack.steps.some(step => step.run === 'pnpm typecheck'));
    assert.ok(pack.steps.findIndex(step => step.run === 'node --import tsx scripts/prepare-release.ts') < pack.steps.findIndex(step => step.run === 'pnpm typecheck'));
    for (const job of [tests, portable]) {
      assert.equal(job.needs, 'package');
      assert.ok(job.steps.some(step => step.run === 'node --import tsx scripts/prepare-release.ts'));
      assert.ok(job.steps.some(step => step.uses === 'actions/download-artifact@v4' && step.with?.name === 'concord-release-package'));
      const commands = job.steps.map(step => step.run ?? '').join('\n');
      assert.match(commands, /--check release\/SHA256SUMS/);
      assert.match(commands, /--strip-components=1 package\/dist/);
      assert.doesNotMatch(commands, /pnpm (?:build|check|typecheck)|scripts\/build/);
    }
    assert.ok(tests.steps.some(step => step.run?.includes('--test-shard="$TEST_SHARD/4" test/*.test.ts')));
    const check = yield* Schema.decodeUnknownEffect(Schema.Struct({ on: Schema.Struct({ push: Schema.Struct({ branches: Schema.Array(Schema.String) }) }) }))(
      parse(yield* fs.readFileString('.github/workflows/check.yml')),
    );
    assert.deepEqual(check.on.push.branches, ['**']);
  }).pipe(Effect.provide(NodeServices.layer)));
});

// @use-case docs/feature/cross-platform-release/use-case/release-from-tag.md
test('release tag sets package and shrinkwrap versions while rejecting invalid metadata', async () => {
  await Effect.runPromise(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const workflow = yield* Schema.decodeUnknownEffect(Workflow)(parse(yield* fs.readFileString('.github/workflows/release.yml')));
    assert.ok(workflow.on.push.tags.includes('v[0-9]*.[0-9]*.[0-9]*'));
    assert.ok(workflow.on.push.tags.includes('concord-v*'));
    const script = workflow.jobs.package.steps.find(step => step.name === 'Prepare package version from release tag')?.run;
    assert.equal(script, 'node --import tsx scripts/prepare-release.ts');
    const root = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-release-identity-' });
    const cases = [
      { tag: 'v0.7.5', top: '0.7.4', inner: '0.7.4', pass: true, version: '0.7.5' },
      { tag: 'concord-v0.7.6', top: '0.7.4', inner: '0.7.4', pass: true, version: '0.7.6' },
      { tag: '', top: '0.7.4', inner: '0.7.4', pass: true, version: '0.7.4' },
      { tag: 'v0.7.4-extra', top: '0.7.4', inner: '0.7.4', pass: false },
      { tag: 'concord-v01.7.4', top: '0.7.4', inner: '0.7.4', pass: false },
      { tag: 'v0.7.5', top: '0.7.3', inner: '0.7.4', pass: false },
      { tag: 'v0.7.5', top: '0.7.4', inner: '0.7.3', pass: false },
    ];
    for (const candidate of cases) {
      yield* fs.writeFileString(join(root, 'package.json'), JSON.stringify({ version: '0.7.4' }));
      yield* fs.writeFileString(join(root, 'npm-shrinkwrap.json'), JSON.stringify({ version: candidate.top, packages: { '': { version: candidate.inner } } }));
      const status: number = yield* spawner.exitCode(ChildProcess.make(process.execPath, ['--import', import.meta.resolve('tsx'), resolve('scripts/prepare-release.ts')], {
        cwd: root, env: { RELEASE_TAG: candidate.tag }, extendEnv: true,
      }));
      assert.equal(Number(status) === 0, candidate.pass, JSON.stringify(candidate));
      const manifest = JSON.parse(yield* fs.readFileString(join(root, 'package.json'))) as { version: string };
      const shrinkwrap = JSON.parse(yield* fs.readFileString(join(root, 'npm-shrinkwrap.json'))) as { version: string; packages: { '': { version: string } } };
      assert.equal(manifest.version, candidate.version ?? '0.7.4');
      assert.equal(shrinkwrap.version, candidate.version ?? candidate.top);
      assert.equal(shrinkwrap.packages[''].version, candidate.version ?? candidate.inner);
    }
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)));
});
