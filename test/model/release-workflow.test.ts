import assert from 'node:assert/strict';
import test from 'node:test';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { parse, stringify } from 'yaml';
import { HAWDB_MACOS_DEPLOYMENT_TARGET } from "../../src/base/installation/index.ts";

const Workflow = Schema.Struct({
  on: Schema.Record(Schema.String, Schema.Unknown),
  jobs: Schema.Struct({ package: Schema.Struct({ steps: Schema.Array(Schema.Struct({
    name: Schema.optional(Schema.String), run: Schema.optional(Schema.String),
  })) }) }),
});

const Job = Schema.Struct({
  if: Schema.optional(Schema.String),
  permissions: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  outputs: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  needs: Schema.optional(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  strategy: Schema.optional(Schema.Struct({ matrix: Schema.Struct({
    shard: Schema.optional(Schema.Array(Schema.Number)),
    include: Schema.optional(Schema.Array(Schema.Struct({
      os: Schema.String, target: Schema.optional(Schema.String), full: Schema.optional(Schema.Boolean),
    }))),
  }) })),
  steps: Schema.Array(Schema.Struct({
    id: Schema.optional(Schema.String),
    name: Schema.optional(Schema.String),
    uses: Schema.optional(Schema.String),
    run: Schema.optional(Schema.String),
    env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    with: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  })),
});

// @use-case docs/feature/cross-platform-release/use-case/release-from-tag.md
test('Herdr catalog sync uses the tagged package after source publication even when tap notification fails', () => Effect.runPromise(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const workflow = yield* Schema.decodeUnknownEffect(Schema.Struct({ jobs: Schema.Struct({ publish: Job, 'herdr-mod': Job }) }))(
    parse(yield* fs.readFileString('.github/workflows/release.yml')),
  );
  const source = workflow.jobs.publish, mirror = workflow.jobs['herdr-mod'];
  assert.equal(source.outputs?.['source-published'], "${{ steps.source-release.outcome == 'success' }}");
  assert.ok(source.steps.some(step => step.id === 'source-release' && step.run?.includes('gh release create')));
  assert.ok(source.steps.some(step => step.name === 'Notify Homebrew tap of the published release' && step.run?.endsWith('exit 1\n')));
  assert.equal(mirror.needs, 'publish');
  assert.equal(mirror.if, "${{ always() && inputs.tag != '' && needs.publish.outputs.source-published == 'true' }}");
  assert.equal(mirror.permissions?.contents, 'write');
  const checkouts = mirror.steps.filter(step => step.uses === 'actions/checkout@v4');
  assert.deepEqual(checkouts.map(step => step.with?.ref), ["${{ format('refs/tags/{0}', inputs.tag) }}", 'master']);
  assert.equal(checkouts[0]?.with?.['persist-credentials'], false);
  assert.equal(checkouts[1]?.with?.token, '${{ github.token }}');
  assert.equal(checkouts[1]?.with?.path, 'herdr-mirror');
  assert.ok(mirror.steps.some(step => step.uses === 'pnpm/action-setup@v4' && step.with?.version === '11.18.0'));
  assert.ok(mirror.steps.some(step => step.uses === 'actions/setup-node@v4' && step.with?.['node-version-file'] === '.node-version'));
  assert.ok(mirror.steps.some(step => step.run === 'pnpm install --frozen-lockfile --ignore-scripts'));
  assert.ok(mirror.steps.some(step => step.uses === 'actions/download-artifact@v4' && step.with?.name === 'concord-release-package'));
  const generation = mirror.steps.find(step => step.name === 'Generate Herdr mirror from the verified release package');
  assert.equal(generation?.env?.RELEASE_TAG, '${{ inputs.tag }}');
  assert.match(generation?.run ?? '', /cd release && sha256sum --check SHA256SUMS/u);
  assert.match(generation?.run ?? '', /tar -xzf release\/concord-\*-linux-x64\.tar\.gz/u);
  assert.match(generation?.run ?? '', /scripts\/herdr-mod-release\.ts "\$RUNNER_TEMP\/herdr-package\/app" "\$RUNNER_TEMP\/herdr-mirror" "\$RELEASE_TAG"/u);
  const commands = mirror.steps.map(step => step.run ?? '').join('\n');
  assert.match(commands, /git -C herdr-mirror add -- concord/u);
  assert.equal((commands.match(/ commit -m /gu) ?? []).length, 1);
  assert.match(commands, /commit -m "Concord Herdr mod \$RELEASE_TAG" -- concord/u);
  assert.match(commands, /git -C herdr-mirror push origin HEAD:master/u);
  assert.doesNotMatch(commands, /--force|gh repo create|gh release|vp build|HERDR_MOD_REPOSITORY_TOKEN/u);
}).pipe(Effect.provide(NodeServices.layer))));

// @use-case docs/feature/cross-platform-release/use-case/release-from-tag.md
test('Herdr workflow sync commits only generated catalog files once and reports a failed push', () => Effect.runPromise(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const workflow = yield* Schema.decodeUnknownEffect(Schema.Struct({ jobs: Schema.Struct({ 'herdr-mod': Job }) }))(
    parse(yield* fs.readFileString('.github/workflows/release.yml')),
  );
  const script = workflow.jobs['herdr-mod'].steps.find(step => step.name === 'Synchronize the generated Concord directory')?.run;
  assert.ok(script);
  const root = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-herdr-workflow-' });
  const git = Effect.fn('herdrWorkflowTest.git')(function*(args: readonly string[]) {
    return yield* spawner.string(ChildProcess.make('git', args, { cwd: root }));
  });
  yield* git(['init', '--bare', '--initial-branch=master', 'remote.git']);
  yield* git(['clone', join(root, 'remote.git'), 'herdr-mirror']);
  yield* fs.writeFileString(join(root, 'herdr-mirror/README.md'), 'source stays intact\n');
  yield* git(['-C', 'herdr-mirror', 'add', '--', 'README.md']);
  yield* git(['-C', 'herdr-mirror', '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'source']);
  yield* git(['-C', 'herdr-mirror', 'push', 'origin', 'HEAD:master']);
  const generated = join(root, 'runner/herdr-mirror/concord');
  yield* fs.makeDirectory(join(generated, 'mods/concord'), { recursive: true });
  yield* fs.writeFileString(join(generated, 'RECIPE.md'), '# Concord\n');
  yield* fs.writeFileString(join(generated, 'preview.png'), 'packaged screenshot fixture');
  yield* fs.writeFileString(join(generated, 'mods/concord/main.js'), 'package bytes');
  yield* fs.writeFileString(join(generated, 'mods/concord/mod.json'), '{"minimumConcordVersion":"1.2.3"}');
  const sync = () => spawner.exitCode(ChildProcess.make('bash', ['-e', '-c', script], { cwd: root, extendEnv: true, env: {
    RELEASE_TAG: 'v1.2.3', RUNNER_TEMP: join(root, 'runner'), GITHUB_STEP_SUMMARY: join(root, 'summary'), GITHUB_REPOSITORY: 'fixture/concord',
  } }));
  assert.equal(Number(yield* sync()), 0);
  assert.equal((yield* git(['-C', 'herdr-mirror', 'rev-list', '--count', 'HEAD'])).trim(), '2');
  assert.deepEqual((yield* git(['-C', 'herdr-mirror', 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'])).trim().split('\n'), [
    'concord/RECIPE.md', 'concord/mods/concord/main.js', 'concord/mods/concord/mod.json', 'concord/preview.png',
  ]);
  assert.equal(yield* fs.readFileString(join(root, 'herdr-mirror/README.md')), 'source stays intact\n');
  assert.equal((yield* git(['--git-dir', 'remote.git', 'rev-parse', 'master'])).trim(), (yield* git(['-C', 'herdr-mirror', 'rev-parse', 'HEAD'])).trim());
  assert.equal(Number(yield* sync()), 0);
  assert.equal((yield* git(['-C', 'herdr-mirror', 'rev-list', '--count', 'HEAD'])).trim(), '2', 'identical release must not add another commit');
  yield* fs.writeFileString(join(generated, 'RECIPE.md'), '# Concord changed\n');
  yield* git(['-C', 'herdr-mirror', 'remote', 'set-url', 'origin', join(root, 'missing.git')]);
  assert.notEqual(Number(yield* sync()), 0, 'push failure must fail the mirror job');
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))));

// @use-case docs/feature/cross-platform-release/use-case/release-from-tag.md
test('release builds two native targets and gates publication on the same commit gate', async () => {
  await Effect.runPromise(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const manifest = yield* Schema.decodeUnknownEffect(Schema.Struct({ scripts: Schema.Record(Schema.String, Schema.String) }))(
      JSON.parse(yield* fs.readFileString('package.json')),
    );
    assert.equal(manifest.scripts.gate, 'node scripts/gate.ts');
    assert.equal(Object.hasOwn(manifest.scripts, 'check'), false);
    assert.equal(yield* fs.exists('scripts/gate.ts'), true);
    assert.equal(yield* fs.exists('scripts/check.ts'), false);
    const graph = yield* Schema.decodeUnknownEffect(Schema.Struct({ jobs: Schema.Struct({ native: Job, package: Job, publish: Job, gate: Schema.Struct({ uses: Schema.String, with: Schema.Struct({ ref: Schema.String }) }) }) }))(
      parse(yield* fs.readFileString('.github/workflows/release.yml')),
    );
    const { native, package: pack, publish } = graph.jobs;
    assert.equal(native.env?.MACOSX_DEPLOYMENT_TARGET, HAWDB_MACOS_DEPLOYMENT_TARGET);
    assert.deepEqual(native.strategy?.matrix.include?.find(target => target.target === 'darwin-arm64'), { os: 'macos-15', target: 'darwin-arm64' });
    assert.equal(native.strategy?.matrix.include?.length, 2);
    assert.equal(pack.needs, 'native');
    assert.deepEqual(publish.needs, ['package', 'verify', 'gate']);
    assert.equal(graph.jobs.gate.uses, './.github/workflows/gate.yml');
    assert.match(graph.jobs.gate.with.ref, /inputs.tag/);
    const build = 'pnpm exec vp exec tsc -p tsconfig.scripts.json';
    assert.ok(pack.steps.some(step => step.run === build));
    assert.ok(pack.steps.findIndex(step => step.run === 'node scripts/prepare-release.ts') < pack.steps.findIndex(step => step.run === build));
    const commands = pack.steps.map(step => step.run ?? '').join('\n');
    assert.equal((commands.match(/scripts\/assemble-release.ts release/gu) ?? []).length, 1);
    assert.ok(publish.steps.some(step => step.uses === 'actions/download-artifact@v4' && step.with?.name === 'concord-release-package'));
    const verification = yield* Schema.decodeUnknownEffect(Schema.Struct({ jobs: Schema.Struct({ verify: Job }) }))(parse(yield* fs.readFileString('.github/workflows/release.yml')));
    assert.equal(verification.jobs.verify.needs, 'package');
    assert.deepEqual(verification.jobs.verify.strategy?.matrix.include, [{ os: 'ubuntu-24.04', target: 'linux-x64' }, { os: 'macos-15', target: 'darwin-arm64' }]);
    const verifyCommands = verification.jobs.verify.steps.map(step => step.run ?? '').join('\n');
    assert.match(verifyCommands, /node scripts\/verify-release-archive.ts/u);
    assert.doesNotMatch(verifyCommands, /vp build|buildApplication|build-native|assemble-release|release-package|pnpm install --prod/u);
    assert.ok(verification.jobs.verify.steps.some(step => step.uses === 'actions/download-artifact@v4' && step.with?.name === 'concord-release-package'));
    const gate = yield* Schema.decodeUnknownEffect(Schema.Struct({ on: Schema.Record(Schema.String, Schema.Unknown), jobs: Schema.Struct({ gate: Job }) }))(
      parse(yield* fs.readFileString('.github/workflows/gate.yml')),
    );
    assert.deepEqual(Object.keys(gate.on), ['push', 'workflow_dispatch', 'workflow_call']);
    assert.deepEqual(gate.on.push, { branches: ['master'] });
    assert.deepEqual(gate.jobs.gate.strategy?.matrix.shard, [1, 2, 3, 4]);
    assert.ok(gate.jobs.gate.steps.some(step => step.run?.includes('pnpm gate --test-shard=${{ matrix.shard }}/4')));
  }).pipe(Effect.provide(NodeServices.layer)));
});

// @use-case docs/feature/cross-platform-release/use-case/release-from-tag.md
test('publication retry reuses identical assets and refuses a different digest', async () => {
  await Effect.runPromise(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const graph = yield* Schema.decodeUnknownEffect(Schema.Struct({ jobs: Schema.Struct({ native: Job, package: Job, publish: Job, gate: Schema.Struct({ uses: Schema.String, with: Schema.Struct({ ref: Schema.String }) }) }) }))(
      parse(yield* fs.readFileString('.github/workflows/release.yml')),
    );
    const script = graph.jobs.publish?.steps.find(step => step.run?.includes('gh release create'))?.run;
    assert.ok(script);
    const root = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-publish-retry-' });
    yield* fs.makeDirectory(join(root, 'bin'));
    yield* fs.makeDirectory(join(root, 'release'));
    const names = ['concord-0.8.2-linux-x64.tar.gz', 'concord-0.8.2-darwin-arm64.tar.gz', 'concord-sdlc-0.8.2.tgz', 'install.sh'];
    const sums: string[] = [], assets: { name: string; digest: string }[] = [];
    for (const name of names) {
      yield* fs.writeFileString(join(root, 'release', name), `immutable ${name} bytes`);
      const digest = createHash('sha256').update(`immutable ${name} bytes`).digest('hex');
      sums.push(`${digest}  ${name}`); assets.push({ name, digest: `sha256:${digest}` });
    }
    const checksumText = `${sums.join('\n')}\n`;
    yield* fs.writeFileString(join(root, 'release/SHA256SUMS'), checksumText);
    assets.push({ name: 'SHA256SUMS', digest: `sha256:${createHash('sha256').update(checksumText).digest('hex')}` });
    // Only the GitHub boundary is simulated; run the production workflow shell and hash actual files.
    yield* fs.writeFileString(join(root, 'bin/gh'), '#!/usr/bin/env bash\nif test "$1" = api; then\n  if test "$GH_CASE" = absent; then echo "HTTP 404" >&2; exit 1; fi\n  if test "$GH_CASE" = network; then echo "connection reset" >&2; exit 1; fi\n  cat "$GH_FIXTURE"\nelse\n  printf "%s\\n" "$*" >> "$GH_CALLS"\nfi\n');
    yield* fs.chmod(join(root, 'bin/gh'), 0o755);
    for (const kind of ['same', 'linux', 'darwin', 'library', 'installer', 'checksums', 'missing', 'tag', 'commit', 'prerelease', 'network', 'absent']) {
      const fixtureAssets = assets.map((asset, index) => ({ ...asset, digest: ['linux', 'darwin', 'library', 'installer', 'checksums'][index] === kind ? `sha256:${'b'.repeat(64)}` : asset.digest }));
      yield* fs.writeFileString(join(root, 'fixture.json'), JSON.stringify({ tag_name: kind === 'tag' ? 'v0.0.0' : 'v0.8.2', target_commitish: kind === 'commit' ? 'b'.repeat(40) : 'a'.repeat(40), draft: false, prerelease: kind === 'prerelease', assets: kind === 'missing' ? fixtureAssets.slice(1) : fixtureAssets }));
      const calls = join(root, `${kind}.calls`);
      const status: number = yield* spawner.exitCode(ChildProcess.make('bash', ['-e', '-c', script], {
        cwd: root, extendEnv: true, env: {
          PATH: `${join(root, 'bin')}:${process.env.PATH ?? ''}`, RELEASE_TAG: 'v0.8.2', RELEASE_COMMIT: 'a'.repeat(40),
          GITHUB_REPOSITORY: 'fixture/concord', GITHUB_STEP_SUMMARY: join(root, 'summary'),
          GH_CASE: kind, GH_FIXTURE: join(root, 'fixture.json'), GH_CALLS: calls,
        },
      }));
      assert.equal(Number(status) === 0, kind === 'same' || kind === 'absent', kind);
      assert.equal(yield* fs.exists(calls), kind === 'absent', kind);
      if (kind === 'absent') {
        const command = yield* fs.readFileString(calls);
        for (const name of [...names, 'SHA256SUMS']) assert.ok(command.includes(name), name);
        assert.doesNotMatch(command, /--clobber/u);
      }
    }
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)));
});

// @feature docs/feature/cross-platform-release/cli.md
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
    assert.equal(script, 'node scripts/prepare-release.ts');
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
      const lock = stringify({ lockfileVersion: '9.0', overrides: { fixture: candidate.override }, importers: { ".": { dependencies: { fixture: { specifier: candidate.dependency } }, devDependencies: {} } } });
      yield* fs.writeFileString(join(root, 'pnpm-lock.yaml'), lock);
      yield* fs.writeFileString(join(root, 'pnpm-workspace.yaml'), stringify({ overrides: { fixture: '1.0.0' } }));
      const status: number = yield* spawner.exitCode(ChildProcess.make(process.execPath, [ resolve('scripts/prepare-release.ts')], {
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
  const workflow = yield* Schema.decodeUnknownEffect(Schema.Struct({ jobs: Schema.Struct({ native: Job, package: Job, publish: Job, gate: Schema.Struct({ uses: Schema.String, with: Schema.Struct({ ref: Schema.String }) }) }) }))(parse(yield* fs.readFileString('.github/workflows/release.yml')));
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

// @use-case docs/feature/cross-platform-release/use-case/release-from-tag.md
test('digest-native publication is manual and both release workflows compile native sources', () => Effect.runPromise(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const native = yield* Schema.decodeUnknownEffect(Schema.Struct({
    on: Schema.Record(Schema.String, Schema.Unknown), jobs: Schema.Struct({ native: Job, publish: Job }),
  }))(parse(yield* fs.readFileString('.github/workflows/native.yml')));
  assert.deepEqual(Object.keys(native.on), ['workflow_dispatch']);
  assert.equal(native.jobs.native.strategy?.matrix.include?.length, 2);
  assert.ok(native.jobs.native.steps.some(step => step.run === 'node scripts/build-native.ts --output native-artifacts --require-portable'));
  assert.ok(native.jobs.native.steps.every(step => !step.run?.includes('--reuse')));
  assert.equal(native.jobs.publish.needs, 'native');
  const publication = native.jobs.publish.steps.map(step => step.run ?? '').join('\n');
  assert.match(publication, /native-\$\{digest:0:16\}/u);
  assert.match(publication, /gh release create/u);
  assert.match(publication, /--prerelease --latest=false/u);
  assert.doesNotMatch(publication, /--clobber|gh release delete/u);
  const release = yield* Schema.decodeUnknownEffect(Schema.Struct({ jobs: Schema.Struct({ native: Job }) }))(parse(yield* fs.readFileString('.github/workflows/release.yml')));
  assert.ok(release.jobs.native.steps.some(step => step.run === 'node scripts/build-native.ts --output native-artifacts --require-portable'));
  assert.ok(release.jobs.native.steps.every(step => !step.run?.includes('--reuse')));
}).pipe(Effect.provide(NodeServices.layer))));
