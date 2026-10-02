import assert from 'node:assert/strict';
import test from 'node:test';
import { join, resolve } from 'node:path';
import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { parse, stringify } from 'yaml';
import { HAWDB_MACOS_DEPLOYMENT_TARGET } from '../src/hawdb-native-contract.js';

const Workflow = Schema.Struct({
  on: Schema.Record(Schema.String, Schema.Unknown),
  jobs: Schema.Struct({ package: Schema.Struct({ steps: Schema.Array(Schema.Struct({
    name: Schema.optional(Schema.String), run: Schema.optional(Schema.String),
  })) }) }),
});

const Job = Schema.Struct({
  needs: Schema.optional(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  strategy: Schema.optional(Schema.Struct({ matrix: Schema.Struct({
    shard: Schema.optional(Schema.Array(Schema.Number)),
    include: Schema.optional(Schema.Array(Schema.Struct({
      os: Schema.String, target: Schema.optional(Schema.String), full: Schema.optional(Schema.Boolean),
    }))),
  }) })),
  steps: Schema.Array(Schema.Struct({
    name: Schema.optional(Schema.String),
    uses: Schema.optional(Schema.String),
    run: Schema.optional(Schema.String),
    with: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  })),
});

// @use-case docs/feature/cross-platform-release/use-case/release-from-tag.md
test('release builds two native targets and gates publication on the same commit checks', async () => {
  await Effect.runPromise(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const graph = yield* Schema.decodeUnknownEffect(Schema.Struct({ jobs: Schema.Struct({ native: Job, package: Job, publish: Job, check: Schema.Struct({ uses: Schema.String, with: Schema.Struct({ ref: Schema.String }) }) }) }))(
      parse(yield* fs.readFileString('.github/workflows/release.yml')),
    );
    const { native, package: pack, publish } = graph.jobs;
    assert.ok(native && pack && publish);
    assert.deepEqual(Object.keys(graph.jobs), ['native', 'package', 'publish', 'check']);
    assert.equal(native.env?.MACOSX_DEPLOYMENT_TARGET, HAWDB_MACOS_DEPLOYMENT_TARGET);
    assert.deepEqual(native.strategy?.matrix.include?.find(target => target.target === 'darwin-arm64'), { os: 'macos-15', target: 'darwin-arm64' });
    assert.equal(native.strategy?.matrix.include?.length, 2);
    assert.equal(pack.needs, 'native');
    assert.deepEqual(publish.needs, ['package', 'check']);
    assert.equal(graph.jobs.check.uses, './.github/workflows/check.yml');
    assert.match(graph.jobs.check.with.ref, /inputs.tag/);
    const build = 'pnpm build && pnpm exec tsc -p tsconfig.scripts.json';
    assert.ok(pack.steps.some(step => step.run === build));
    assert.ok(pack.steps.findIndex(step => step.run === 'node --import tsx scripts/prepare-release.ts') < pack.steps.findIndex(step => step.run === build));
    const commands = pack.steps.map(step => step.run ?? '').join('\n');
    assert.match(commands, /sha256sum release\/concord-sdlc-\*\.tgz > release\/SHA256SUMS/);
    assert.equal((commands.match(/scripts\/pack-release.ts release/gu) ?? []).length, 1);
    assert.ok(publish.steps.some(step => step.uses === 'actions/download-artifact@v4' && step.with?.name === 'concord-release-package'));
    assert.match(commands, /pnpm install --prod --frozen-lockfile --ignore-scripts/);
    assert.match(commands, /verify-installed-native.ts/);
    const check = yield* Schema.decodeUnknownEffect(Schema.Struct({ on: Schema.Record(Schema.String, Schema.Unknown) }))(
      parse(yield* fs.readFileString('.github/workflows/check.yml')),
    );
    assert.deepEqual(Object.keys(check.on), ['workflow_dispatch', 'workflow_call']);
  }).pipe(Effect.provide(NodeServices.layer)));
});

// @use-case docs/feature/cross-platform-release/use-case/release-from-tag.md
test('publication retry reuses identical assets and refuses a different digest', async () => {
  await Effect.runPromise(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const graph = yield* Schema.decodeUnknownEffect(Schema.Struct({ jobs: Schema.Struct({ native: Job, package: Job, publish: Job, check: Schema.Struct({ uses: Schema.String, with: Schema.Struct({ ref: Schema.String }) }) }) }))(
      parse(yield* fs.readFileString('.github/workflows/release.yml')),
    );
    const script = graph.jobs.publish?.steps.find(step => step.run?.includes('gh release create'))?.run;
    assert.ok(script);
    const root = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-publish-retry-' });
    yield* fs.makeDirectory(join(root, 'bin'));
    yield* fs.makeDirectory(join(root, 'release'));
    const digest = 'a'.repeat(64);
    yield* fs.writeFileString(join(root, 'release/SHA256SUMS'), `${digest}  release/concord-sdlc-0.8.2.tgz\n`);
    // Only the remote GitHub boundary is simulated; execute the actual workflow shell.
    yield* fs.writeFileString(join(root, 'bin/gh'), '#!/usr/bin/env bash\nif test "$1" = api; then\n  if test "$GH_CASE" = absent; then exit 1; fi\n  cat "$GH_FIXTURE"\nelse\n  printf "%s\\n" "$*" >> "$GH_CALLS"\nfi\n');
    yield* fs.chmod(join(root, 'bin/gh'), 0o755);
    for (const kind of ['same', 'different', 'absent']) {
      yield* fs.writeFileString(join(root, 'fixture.json'), JSON.stringify({ assets: [{ name: 'concord-sdlc-0.8.2.tgz', digest: `sha256:${kind === 'different' ? 'b'.repeat(64) : digest}` }] }));
      const calls = join(root, `${kind}.calls`);
      const status: number = yield* spawner.exitCode(ChildProcess.make('bash', ['-e', '-c', script], {
        cwd: root, extendEnv: true, env: {
          PATH: `${join(root, 'bin')}:${process.env.PATH ?? ''}`, RELEASE_TAG: 'v0.8.2',
          GITHUB_REPOSITORY: 'fixture/concord', GITHUB_STEP_SUMMARY: join(root, 'summary'),
          GH_CASE: kind, GH_FIXTURE: join(root, 'fixture.json'), GH_CALLS: calls,
        },
      }));
      assert.equal(Number(status) === 0, kind !== 'different');
      assert.equal(yield* fs.exists(calls), kind === 'absent', 'existing release must never be overwritten');
      if (kind === 'absent') assert.match(yield* fs.readFileString(calls), /^release create v0\.8\.2 /u);
    }
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)));
});

// @use-case docs/feature/cross-platform-release/use-case/release-from-tag.md
test('release tag sets the manifest version while preserving and validating the pnpm lock', async () => {
  await Effect.runPromise(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const workflow = yield* Schema.decodeUnknownEffect(Workflow)(parse(yield* fs.readFileString('.github/workflows/release.yml')));
    assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
    const dispatch = yield* Schema.decodeUnknownEffect(Schema.Struct({
      on: Schema.Struct({ push: Schema.Struct({ tags: Schema.Array(Schema.String) }) }),
      jobs: Schema.Record(Schema.String, Job),
    }))(parse(yield* fs.readFileString('.github/workflows/release-tag.yml')));
    assert.ok(dispatch.on.push.tags.includes('v[0-9]*.[0-9]*.[0-9]*'));
    assert.ok(dispatch.on.push.tags.includes('concord-v*'));
    assert.ok(dispatch.jobs.dispatch?.steps.some(step => step.run?.includes('gh workflow run release.yml --ref "$RELEASE_BRANCH" --field "tag=$RELEASE_TAG"')));
    const script = workflow.jobs.package.steps.find(step => step.name === 'Prepare package version from release tag')?.run;
    assert.equal(script, 'node --import tsx scripts/prepare-release.ts');
    const root = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-release-identity-' });
    const cases = [
      { tag: 'v0.7.5', dependency: '1.0.0', override: '1.0.0', pass: true, version: '0.7.5' },
      { tag: 'concord-v0.7.6', dependency: '1.0.0', override: '1.0.0', pass: true, version: '0.7.6' },
      { tag: '', dependency: '1.0.0', override: '1.0.0', pass: true, version: '0.7.4' },
      { tag: 'v0.7.4-extra', dependency: '1.0.0', override: '1.0.0', pass: false },
      { tag: 'concord-v01.7.4', dependency: '1.0.0', override: '1.0.0', pass: false },
      { tag: 'v0.7.5', dependency: '0.9.0', override: '1.0.0', pass: false },
      { tag: 'v0.7.5', dependency: '1.0.0', override: '0.9.0', pass: false },
    ];
    for (const candidate of cases) {
      yield* fs.writeFileString(join(root, 'package.json'), JSON.stringify({ version: '0.7.4', dependencies: { fixture: '1.0.0' }, devDependencies: {} }));
      const lock = stringify({ lockfileVersion: '9.0', overrides: { fixture: candidate.override }, importers: { '.': { dependencies: { fixture: { specifier: candidate.dependency } }, devDependencies: {} } } });
      yield* fs.writeFileString(join(root, 'pnpm-lock.yaml'), lock);
      yield* fs.writeFileString(join(root, 'pnpm-workspace.yaml'), stringify({ overrides: { fixture: '1.0.0' } }));
      const status: number = yield* spawner.exitCode(ChildProcess.make(process.execPath, ['--import', import.meta.resolve('tsx'), resolve('scripts/prepare-release.ts')], {
        cwd: root, env: { RELEASE_TAG: candidate.tag }, extendEnv: true,
      }));
      assert.equal(Number(status) === 0, candidate.pass, JSON.stringify(candidate));
      const manifest = JSON.parse(yield* fs.readFileString(join(root, 'package.json'))) as { version: string };
      assert.equal(manifest.version, candidate.version ?? '0.7.4');
      assert.equal(yield* fs.readFileString(join(root, 'pnpm-lock.yaml')), lock);
    }
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)));
});

// @use-case docs/feature/cross-platform-release/use-case/release-from-tag.md
test('channel notification fails visibly without credentials and resumes from an existing receipt', async () => {
 await Effect.runPromise(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const workflow = yield* Schema.decodeUnknownEffect(Schema.Struct({ jobs: Schema.Struct({ native: Job, package: Job, publish: Job, check: Schema.Struct({ uses: Schema.String, with: Schema.Struct({ ref: Schema.String }) }) }) }))(parse(yield* fs.readFileString('.github/workflows/release.yml')));
  const script = workflow.jobs.publish?.steps.find(step => step.name === 'Notify Homebrew tap of the published release')?.run;
  assert(script);
  const root = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-channel-notify-' });
  yield* fs.makeDirectory(join(root, 'bin'));
  yield* fs.writeFileString(join(root, 'bin/gh'), '#!/bin/sh\nif test "$1" = release; then test "$CASE" = receipt; else test "$CASE" = dispatch; fi\n');
  yield* fs.writeFileString(join(root, 'bin/sleep'), '#!/bin/sh\nexit 0\n');
  yield* fs.chmod(join(root, 'bin/gh'), 0o755); yield* fs.chmod(join(root, 'bin/sleep'), 0o755);
  for (const kind of ['missing', 'failed', 'dispatch', 'receipt']) {
   const status: number = yield* spawner.exitCode(ChildProcess.make('bash', ['-e', '-c', script], { cwd: root, extendEnv: true, env: {
    PATH: `${join(root, 'bin')}:${process.env.PATH ?? ''}`, RELEASE_TAG: 'v0.11.0', CASE: kind,
    TAP_WORKFLOW_TOKEN: kind === 'missing' || kind === 'receipt' ? '' : 'fixture-token', GITHUB_STEP_SUMMARY: join(root, 'summary'),
   } }));
   assert.equal(Number(status) === 0, kind === 'dispatch' || kind === 'receipt', kind);
  }
 }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)));
});
