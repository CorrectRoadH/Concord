import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
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

// @use-case docs/feature/cross-platform-release/use-case/release-from-tag.md
test('release identity accepts both tag formats and blocks inconsistent package metadata', async () => {
  await Effect.runPromise(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const workflow = yield* Schema.decodeUnknownEffect(Workflow)(parse(yield* fs.readFileString('.github/workflows/release.yml')));
    assert.ok(workflow.on.push.tags.includes('v[0-9]*.[0-9]*.[0-9]*'));
    assert.ok(workflow.on.push.tags.includes('concord-v*'));
    const script = workflow.jobs.package.steps.find(step => step.name === 'Verify immutable release identity')?.run;
    assert.ok(script);
    const root = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-release-identity-' });
    yield* fs.writeFileString(join(root, 'package.json'), JSON.stringify({ version: '0.7.4' }));
    const cases = [
      { tag: 'v0.7.4', top: '0.7.4', inner: '0.7.4', pass: true },
      { tag: 'concord-v0.7.4', top: '0.7.4', inner: '0.7.4', pass: true },
      { tag: '', top: '0.7.4', inner: '0.7.4', pass: true },
      { tag: 'v0.7.5', top: '0.7.4', inner: '0.7.4', pass: false },
      { tag: 'concord-v0.7.5', top: '0.7.4', inner: '0.7.4', pass: false },
      { tag: 'v0.7.4-extra', top: '0.7.4', inner: '0.7.4', pass: false },
      { tag: 'v0.7.4', top: '0.7.3', inner: '0.7.4', pass: false },
      { tag: 'v0.7.4', top: '0.7.4', inner: '0.7.3', pass: false },
    ];
    for (const candidate of cases) {
      yield* fs.writeFileString(join(root, 'npm-shrinkwrap.json'), JSON.stringify({ version: candidate.top, packages: { '': { version: candidate.inner } } }));
      const status: number = yield* spawner.exitCode(ChildProcess.make('bash', ['-e', '-c', script], {
        cwd: root, env: { RELEASE_TAG: candidate.tag }, extendEnv: true,
      }));
      assert.equal(Number(status) === 0, candidate.pass, JSON.stringify(candidate));
    }
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)));
});
