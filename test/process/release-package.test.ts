import { verifyInstalledStartup } from '../support/installed-startup.js';
import { verifyInstalledHerdrMod } from '../support/installed-herdr-mod.js';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema } from 'effect';
import { packConcord } from '../../scripts/release-package.js';
import { packageBin } from '../support/installed-package.js';
import { hawdbTarget, installationResources } from '../../src/base/installation/index.js';
import { builtConcord } from '../support/installed-package.js';
import { tmpdir } from '../support/temporary.js';

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

// @use-case docs/feature/cross-platform-release/use-case/release-from-tag.md
test('one release archive contains the declared distribution and starts from its installed bin', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-release-test-'));
  try {
    const output = join(root, 'build');
    const build = spawnSync('pnpm', ['exec', 'vp', 'build', '--outDir', output], { encoding: 'utf8', timeout: 180_000, env: { ...process.env, NODE_OPTIONS: '' } });
    assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
    const beforePack = performance.now();
    const artifact = await Effect.runPromise(packConcord(root, output).pipe(Effect.provide(NodeServices.layer)));
    const packMs = performance.now() - beforePack;
    assert.deepEqual(artifact.files.map(file => file.path).sort(), builtConcord(output).files.map(file => file.path).sort());
    const consumer = join(root, 'consumer'); mkdirSync(consumer);
    const beforeUnpack = performance.now();
    execFileSync('tar', ['-xzf', artifact.filename, '-C', consumer]);
    const unpackMs = performance.now() - beforeUnpack;
    const installed = join(consumer, 'package');
    const notices = readFileSync(join(installed, 'dist/web/.vite/license.md'), 'utf8');
    assert.match(notices, /## pele - [^\n]+ \(MIT\)/u);
    assert.match(notices, /MIT/u);
    assert.doesNotMatch(notices, /## mermaid - /u);
    const store = execFileSync('pnpm', ['store', 'path'], { encoding: 'utf8' }).trim();
    const beforeInstall = performance.now();
    const install = spawnSync('pnpm', ['install', '--prod', '--frozen-lockfile', '--ignore-scripts', '--offline', '--store-dir', store, '--package-import-method=copy'], { cwd: installed, encoding: 'utf8', timeout: 120_000 });
    assert.equal(install.status, 0, `${install.stdout}\n${install.stderr}\n${String(install.error)}`);
    const installMs = performance.now() - beforeInstall;
    const version = execFileSync(process.execPath, [packageBin(installed), '--version'], { cwd: consumer, encoding: 'utf8', timeout: 30_000 });
    assert.equal(version.trim(), `concord v${artifact.version}`);
    for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) assert.deepEqual(readFileSync(join(installed, file)), readFileSync(file));
    for (const file of ['dist/herdr-mod/main.js', 'dist/herdr-mod/mod.json', 'dist/herdr-mod/NOTICE.txt']) assert.ok(artifact.files.some(entry => entry.path === file), `Missing ${file}`);
    mkdirSync(join(root, 'startup'));
    await verifyInstalledStartup(installed, join(root, 'startup'));
    mkdirSync(join(root, 'herdr'));
    verifyInstalledHerdrMod(installed, join(root, 'herdr'));
    const nativeBinary = join(installationResources(installed).native, hawdbTarget(), 'hawdb.node');
    const nativeBytes = readFileSync(nativeBinary);
    const native = spawnSync(process.execPath, [
      '--import', import.meta.resolve('tsx'),
      fileURLToPath(new URL('../../scripts/verify-installed-native.ts', import.meta.url)), installed,
    ], { cwd: consumer, encoding: 'utf8', timeout: 180_000, env: { ...process.env, NODE_OPTIONS: '' } });
    const nativeDiagnostics = `${native.stdout}\n${native.stderr}\n${String(native.error)}\nsignal=${native.signal}`;
    assert.deepEqual(readFileSync(nativeBinary), nativeBytes, `Installed native verification must restore the binary\n${nativeDiagnostics}`);
    assert.equal(native.status, 0, nativeDiagnostics);
    Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({
      engine: Schema.Literal('hawdb'), revision: Schema.String, abi: Schema.String, target: Schema.Literal(hawdbTarget()),
      compilerOnPath: Schema.Literal(false), helperOnPath: Schema.Literal(false),
      persistentHit: Schema.Literal(true), currentRecall: Schema.Literal(true), rebuilt: Schema.Literal(true),
    })))(native.stdout);
    const templates = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ templates: Schema.Array(Schema.Struct({ name: Schema.String })) })))(execFileSync(process.execPath, [packageBin(installed), 'template', 'list', '--json'], { cwd: consumer, encoding: 'utf8', timeout: 30_000 }));
    assert.ok(templates.templates.some(template => template.name === 'feature'));
    console.error(`# Release packaging: pack=${(packMs / 1000).toFixed(3)}s; unpack=${(unpackMs / 1000).toFixed(3)}s; install=${(installMs / 1000).toFixed(3)}s`);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));
