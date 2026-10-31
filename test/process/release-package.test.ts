import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { packConcord } from '../../scripts/release-package.js';
import { packageBin } from '../../scripts/package-location.js';
import { builtConcord } from '../support/installed-package.js';
import { tmpdir } from '../support/temporary.js';

// @use-case docs/feature/cross-platform-release/use-case/release-from-tag.md
test('one release archive contains the declared distribution and starts from its installed bin', () => Effect.runPromise(Effect.sync(() => {
  const root = mkdtempSync(join(tmpdir(), 'concord-release-test-'));
  try {
    const beforePack = performance.now();
    const artifact = packConcord(root);
    const packMs = performance.now() - beforePack;
    assert.deepEqual(artifact.files.map(file => file.path).sort(), builtConcord().files.map(file => file.path).sort());
    const consumer = join(root, 'consumer'); mkdirSync(consumer);
    const beforeUnpack = performance.now();
    execFileSync('tar', ['-xzf', artifact.filename, '-C', consumer]);
    const unpackMs = performance.now() - beforeUnpack;
    const installed = join(consumer, 'package');
    const store = execFileSync('pnpm', ['store', 'path'], { encoding: 'utf8' }).trim();
    const beforeInstall = performance.now();
    const install = spawnSync('pnpm', ['install', '--prod', '--frozen-lockfile', '--ignore-scripts', '--offline', '--store-dir', store, '--package-import-method=copy'], { cwd: installed, encoding: 'utf8', timeout: 120_000 });
    assert.equal(install.status, 0, `${install.stdout}\n${install.stderr}\n${String(install.error)}`);
    const installMs = performance.now() - beforeInstall;
    const version = execFileSync(process.execPath, [packageBin(installed), '--version'], { cwd: consumer, encoding: 'utf8', timeout: 30_000 });
    assert.equal(version.trim(), `concord v${artifact.version}`);
    for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) assert.deepEqual(readFileSync(join(installed, file)), readFileSync(file));
    const templates = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ templates: Schema.Array(Schema.Struct({ name: Schema.String })) })))(execFileSync(process.execPath, [packageBin(installed), 'template', 'list', '--json'], { cwd: consumer, encoding: 'utf8', timeout: 30_000 }));
    assert.ok(templates.templates.some(template => template.name === 'feature'));
    console.error(`# Release packaging: pack=${(packMs / 1000).toFixed(3)}s; unpack=${(unpackMs / 1000).toFixed(3)}s; install=${(installMs / 1000).toFixed(3)}s`);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));
