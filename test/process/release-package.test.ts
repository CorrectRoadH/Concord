// 跨进程保证：运行环境——真实发布归档在无系统runtime路径下用捆绑runtime安装运行，升级保留活服务并隔离native损坏。
import { verifyInstalledBundles } from '../support/installed-bundles.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { packConcord } from '../../scripts/release-package.ts';
import { applicationRoot, packageBin } from '../support/installed-package.ts';
import { builtConcord } from '../support/installed-package.ts';
import { packageCommand } from '../../scripts/package-command.ts';
import { verifyPackageInventory } from '../support/package-inventory.ts';
import { verifyArchiveContents, verifyArchiveRuntime } from '../support/archive-acceptance.ts';
import { tmpdir } from '../support/temporary.ts';

// @use-case docs/feature/cross-platform-release/use-case/release-from-tag.md
test('release packing preserves source identity bytes and tar contents without a build', () => Effect.runPromise(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ directory: tmpdir(), prefix: 'concord-release-identity-' });
  const repository = join(root, 'source'), destination = join(root, 'archives'), extracted = join(root, 'extracted');
  yield* fs.makeDirectory(repository);
  yield* fs.makeDirectory(extracted);
  const files = {
    'package.json': `${JSON.stringify({ name: 'concord-pack-fixture', version: '1.2.3', files: ['payload.txt'] }, null, 2)}\n`,
    'pnpm-lock.yaml': 'lockfileVersion: \'9.0\'\n',
    'pnpm-workspace.yaml': 'packages: []\n',
    'payload.txt': 'release fixture bytes\n',
  };
  for (const [name, bytes] of Object.entries(files)) yield* fs.writeFileString(join(repository, name), bytes);
  const artifact = yield* packConcord(destination, repository);
  assert.equal(artifact.name, 'concord-pack-fixture');
  assert.equal(artifact.version, '1.2.3');
  assert.equal(artifact.filename, join(destination, 'concord-pack-fixture-1.2.3.tgz'));
  assert.deepEqual(artifact.files.map(file => file.path).sort(), Object.keys(files).sort());
  // The returned archive must remain usable after packConcord's scratch scope closes.
  execFileSync('tar', ['-xzf', artifact.filename, '-C', extracted]);
  for (const [name, bytes] of Object.entries(files)) assert.equal(yield* fs.readFileString(join(extracted, 'package', name)), bytes);
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))));

// @use-case docs/feature/cross-platform-release/use-case/release-from-tag.md#package
test('one native release archive owns all installed product acceptance', { concurrency: 4 }, context => Effect.runPromise(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const scratch = yield* fs.makeTempDirectoryScoped({ directory: tmpdir(), prefix: 'concord-archive-acceptance-' });
  const archiveRoot = process.env.CONCORD_TEST_PACKAGE_ROOT;
  assert.ok(archiveRoot, 'The packaging runner must prepare and lease the shared archive cache before starting this file. Run pnpm gate.');
  const beforeUnpack = performance.now();
  const archives = (yield* fs.readDirectory(archiveRoot)).filter(name => /^concord-.+-(?:linux-x64|darwin-arm64)\.tar\.gz$/u.test(name));
  assert.equal(archives.length, 1, 'shared build cache must contain one complete target archive');
  const filename = archives[0]!;
  const archive = join(archiveRoot, filename);
  const digest = createHash('sha256').update(yield* fs.readFile(archive)).digest('hex');
  assert.equal((yield* fs.readFileString(`${archive}.sha256`)).trim(), `${digest}  ${filename}`);
  const installed = join(scratch, 'installed');
  yield* fs.makeDirectory(installed);
  yield* spawner.exitCode(ChildProcess.make('tar', ['-xzf', archive, '-C', installed])).pipe(Effect.tap(code => Effect.sync(() => assert.equal(Number(code), 0))));
  const unpackMs = performance.now() - beforeUnpack;
  yield* Effect.sync(() => verifyArchiveContents(installed));
  const app = applicationRoot(installed), artifact = builtConcord(installed);
  yield* Effect.sync(() => verifyPackageInventory(artifact, installed));
  yield* verifyInstalledBundles(app);
  const notices = yield* fs.readFileString(join(app, 'dist/web/.vite/license.md'));
  assert.match(notices, /## pele - [^\n]+ \(MIT\)/u); assert.match(notices, /MIT/u); assert.doesNotMatch(notices, /## mermaid - /u);
  for (const file of ['pnpm-lock.yaml', 'pnpm-workspace.yaml']) assert.deepEqual(yield* fs.readFile(join(app, file)), yield* fs.readFile(file));
  // Build metadata deliberately adds gitHead to the source manifest; all source fields remain exact.
  const Manifest = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown));
  const sourceManifest = yield* Schema.decodeUnknownEffect(Manifest)(yield* fs.readFileString('package.json'));
  const installedManifest = yield* Schema.decodeUnknownEffect(Manifest)(yield* fs.readFileString(join(app, 'package.json')));
  Schema.decodeUnknownSync(Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/u)))(installedManifest.gitHead);
  assert.deepEqual(installedManifest, { ...sourceManifest, gitHead: installedManifest.gitHead });
  for (const file of ['dist/herdr-mod/main.js', 'dist/herdr-mod/mod.json', 'dist/herdr-mod/NOTICE.txt']) assert.ok(artifact.files.some(entry => entry.path === `app/${file}`), `Missing ${file}`);
  const [command, ...prefix] = packageCommand(packageBin(installed));
  const templates = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ templates: Schema.Array(Schema.Struct({ name: Schema.String })) })))(execFileSync(command, [...prefix, 'template', 'list', '--json'], { cwd: scratch, encoding: 'utf8', timeout: 30_000, env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' } }));
  assert.ok(templates.templates.some(template => template.name === 'feature'));
  // Prepare damage fixtures before starting independent checks against the shared candidate.
  const startup = join(scratch, 'startup-install');
  yield* fs.copy(installed, startup);
  yield* fs.makeDirectory(join(scratch, 'startup'));
  yield* fs.makeDirectory(join(scratch, 'herdr'));
  const check = async (action: string, candidate = installed, directory = scratch): Promise<void> => {
    const code = await Effect.runPromise(spawner.exitCode(ChildProcess.make(process.execPath, [
      fileURLToPath(new URL('../support/archive-check.ts', import.meta.url)), action, candidate, directory, archive,
    ], { env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' }, stdout: 'inherit', stderr: 'inherit' })).pipe(Effect.scoped));
    assert.equal(Number(code), 0, `Archive ${action} acceptance failed`);
  };
  yield* Effect.promise(() => Promise.all([
    // @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
    context.test('installed native projections survive damage and repair without compilers', () => check('native')),
    // @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
    context.test('installed startup preserves static and fallback routing', () => check('startup', startup, join(scratch, 'startup'))),
    // @use-case docs/feature/cross-platform-release/use-case/install-with-script.md#upgrade-running-service
    context.test('real archive upgrades and rollback preserve active installation services', () => check('lifecycle')),
    // @use-case docs/feature/cross-platform-release/use-case/release-from-tag.md#verify
    context.test('bundled runtime, native cache and project loop avoid PATH runtimes', () => verifyArchiveRuntime(installed, scratch)),
    // @feature docs/engineering/testing/README.md#检查入口
    context.test('archive consumers share bytes and isolate native damage', () => check('consumers')),
    // @use-case docs/feature/herdr-mod/use-case/install-with-cli.md#install
    context.test('packaged Herdr installation preserves ownership and host failure receipts', () => check('herdr', installed, join(scratch, 'herdr'))),
    // @use-case docs/feature/cross-platform-release/use-case/install-with-script.md#verify
    context.test('the same-run archive installs and checks without system runtimes', () => check('installer')),
  ]));
  console.error(`# Release packaging: unpack=${(unpackMs / 1000).toFixed(3)}s; one CLI archive`);
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))));
