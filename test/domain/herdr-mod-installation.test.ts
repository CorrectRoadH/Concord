import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect } from 'effect';
import { manageHerdrMod, type HerdrInstallHost } from '../../src/base/installation/herdr-mod.ts';
import { ConcordError } from '../../src/model/index.ts';
import { modManifest } from '../../src/model/herdr-mod/index.ts';
import { tmpdir } from '../support/temporary.ts';

const unavailable: HerdrInstallHost = { available: Effect.succeed(false), check: () => Effect.die('unavailable host must not be checked') };
const run = (operation: 'install' | 'uninstall', home: string, resources: string, host = unavailable, dryRun = false, sourceRoot?: string) =>
  Effect.runPromise(manageHerdrMod(operation, home, resources, dryRun, sourceRoot, host).pipe(Effect.provide(NodeServices.layer)));
const named = (code: string) => (cause: unknown): boolean => cause instanceof ConcordError && cause.code === code;
function packageFixture(root: string): string {
  const resources = join(root, 'package'); mkdirSync(resources);
  writeFileSync(join(resources, 'main.js'), 'export default class Concord {}');
  writeFileSync(join(resources, 'mod.json'), JSON.stringify(modManifest('1.2.3')));
  writeFileSync(join(resources, 'NOTICE.txt'), 'Concord Herdr mod bundles Effect.\n\nMIT License\n');
  return resources;
}

// @use-case docs/feature/herdr-mod/use-case/install-with-cli.md#install
test('source mod installation builds outside the checkout, updates its bytes and preserves unrelated files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-source-herdr-'));
  const app = join(root, 'herdr'), target = join(app, 'mods/concord');
  mkdirSync(join(app, 'mods/other'), { recursive: true });
  writeFileSync(join(app, 'mods/other/main.js'), 'other');
  writeFileSync(join(app, 'settings.json'), '{"theme":"mine"}');
  const install = (dryRun = false) => run('install', app, join(root, 'missing-package-resources'), unavailable, dryRun, resolve('.'));
  try {
    await install(true); assert.equal(existsSync(target), false);
    const receipt = await install();
    assert.equal(receipt.path, target);
    assert.match(readFileSync(join(target, 'main.js'), 'utf8'), /gpui-kit/u);
    assert.match(readFileSync(join(target, 'NOTICE.txt'), 'utf8'), /MIT/u);
    const version = (JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }).version;
    assert.deepEqual(JSON.parse(readFileSync(join(target, 'mod.json'), 'utf8')), modManifest(version));
    assert.equal(existsSync(resolve('dist')), false);
    writeFileSync(join(target, 'main.js'), 'damaged');
    assert.equal((await install()).updated, true);
    assert.notEqual(readFileSync(join(target, 'main.js'), 'utf8'), 'damaged');
    assert.deepEqual(readdirSync(app).sort(), ['mods', 'settings.json'], 'scoped build resources are removed');
    assert.deepEqual(readdirSync(target).sort(), ['NOTICE.txt', 'main.js', 'mod.json'], 'no staged files remain');
    assert.equal(readFileSync(join(app, 'mods/other/main.js'), 'utf8'), 'other');
    assert.equal(readFileSync(join(app, 'settings.json'), 'utf8'), '{"theme":"mine"}');
    await run('uninstall', app, 'unused'); assert.equal(existsSync(target), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/herdr-mod/use-case/install-with-cli.md#install
test('missing Herdr returns its installer and next step without creating any files, including dry-run', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-herdr-missing-'));
  try {
    for (const dryRun of [false, true]) {
      await assert.rejects(run('install', join(root, 'absent'), 'unused', unavailable, dryRun), cause => {
        assert.ok(named('HerdrNotFound')(cause));
        assert.match((cause as ConcordError).message, /curl -fsSL https:\/\/releases\.herdr\.dev\/app\/install\.sh \| sh/u);
        assert.match((cause as ConcordError).message, /concord herdr install/u);
        return true;
      });
      assert.deepEqual(readdirSync(root), []);
    }
    const receipt = await run('uninstall', join(root, 'absent'), 'unused');
    assert.equal(receipt.absent, true); assert.deepEqual(readdirSync(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/herdr-mod/use-case/install-with-cli.md#install
test('a command without config creates the selected home, checks the installed mod and reports updates', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-herdr-first-'));
  const home = join(root, 'selected-home'), target = join(home, 'mods/concord');
  const checks: string[] = [];
  const host: HerdrInstallHost = { available: Effect.succeed(true), check: path => Effect.sync(() => {
    checks.push(path); assert.equal(readFileSync(join(path, 'main.js'), 'utf8'), 'export default class Concord {}');
    return { code: 0, output: 'ok' };
  }) };
  try {
    const resources = packageFixture(root);
    await run('install', home, resources, host, true); assert.equal(existsSync(home), false); assert.deepEqual(checks, []);
    assert.equal((await run('install', home, resources, host)).openHerdr, true);
    const updated = await run('install', home, resources, host);
    assert.equal(updated.updated, true); assert.equal('openHerdr' in updated, false);
    for (const name of ['main.js', 'mod.json', 'NOTICE.txt']) assert.equal(readFileSync(join(target, name), 'utf8'), readFileSync(join(resources, name), 'utf8'));
    assert.deepEqual(checks, [target, target]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/herdr-mod/use-case/install-with-cli.md#install
test('non-Concord paths and symbolic links are refused without overwriting their files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-herdr-occupied-'));
  const home = join(root, 'home'), target = join(home, 'mods/concord'), other = join(home, 'mods/other');
  mkdirSync(other, { recursive: true }); writeFileSync(join(other, 'NOTICE.txt'), 'Concord Herdr mod bundles Effect.\n');
  writeFileSync(join(other, 'main.js'), 'preserve');
  try {
    for (const kind of ['directory', 'file', 'link', 'dangling-link']) {
      if (kind === 'directory') { mkdirSync(target); writeFileSync(join(target, 'main.js'), 'not Concord'); }
      else if (kind === 'file') writeFileSync(target, 'occupied');
      else symlinkSync(kind === 'link' ? other : join(root, 'missing'), target);
      for (const operation of ['install', 'uninstall'] as const) {
        await assert.rejects(run(operation, home, 'unused'), named('HerdrModPathOccupied'));
        assert.equal(readFileSync(join(other, 'main.js'), 'utf8'), 'preserve');
      }
      rmSync(target, { recursive: true, force: true });
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/herdr-mod/use-case/install-with-cli.md#install
test('a failed host check preserves the installed mod and retains the host output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-herdr-check-'));
  const home = join(root, 'home');
  try {
    const resources = packageFixture(root), output = 'Herdr stdout\nHerdr stderr\n';
    const host: HerdrInstallHost = { available: Effect.succeed(true), check: () => Effect.succeed({ code: 7, output }) };
    await assert.rejects(run('install', home, resources, host), cause => {
      assert.ok(named('HerdrModCheckFailed')(cause));
      assert.deepEqual((cause as ConcordError).details, { output }); return true;
    });
    assert.equal(readFileSync(join(home, 'mods/concord/main.js'), 'utf8'), readFileSync(join(resources, 'main.js'), 'utf8'));
    assert.deepEqual(readdirSync(home), ['mods']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/herdr-mod/use-case/install-with-cli.md#install
test('a source build failure releases its scratch directory and preserves the installed version', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-herdr-build-failure-'));
  const home = join(root, 'home'), sourceRoot = join(root, 'broken-source');
  try {
    const resources = packageFixture(root);
    mkdirSync(home); mkdirSync(sourceRoot);
    writeFileSync(join(sourceRoot, 'tsconfig.json'), '{}');
    await run('install', home, resources);
    await assert.rejects(run('install', home, resources, unavailable, false, sourceRoot));
    assert.equal(readFileSync(join(home, 'mods/concord/main.js'), 'utf8'), readFileSync(join(resources, 'main.js'), 'utf8'));
    assert.deepEqual(readdirSync(home), ['mods']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
