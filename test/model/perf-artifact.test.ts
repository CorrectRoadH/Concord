import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect } from 'effect';
import { loadArtifact, verifyArtifact } from '../../scripts/perf/artifact.ts';
import { tmpdir } from '../support/temporary.ts';
import { packageCommand } from '../../scripts/package-command.ts';

// @feature docs/feature/local-sdlc/README.md
test('benchmark identity follows the built artifact while source HEAD advances', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-bench-identity-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  try {
    git('init', '-q');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'concord-sdlc', bin: { concord: 'dist/entry.js' } }));
    writeFileSync(join(root, '.gitignore'), 'dist/\n');
    writeFileSync(join(root, 'source.ts'), 'export const value = 1;\n');
    git('add', 'package.json', '.gitignore', 'source.ts');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'first');
    const builtCommit = git('rev-parse', 'HEAD');
    mkdirSync(join(root, 'dist'));
    writeFileSync(join(root, 'dist/entry.js'), 'export const value = 1;\n');
    writeFileSync(join(root, 'dist/build-identity.json'), JSON.stringify({ format: 'concord.build-source/v1', commit: builtCommit, dirty: false }));
    const artifact = await Effect.runPromise(loadArtifact('candidate', root).pipe(Effect.scoped, Effect.provide(NodeServices.layer)));
    assert.equal(artifact.entry, join(root, 'dist/entry.js'));
    writeFileSync(join(root, 'source.ts'), 'export const value = 2;\n');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qam', 'second');
    const observed = await Effect.runPromise(loadArtifact('candidate', root).pipe(Effect.scoped, Effect.provide(NodeServices.layer)));
    assert.equal(observed.commit, builtCommit);
    assert.equal(observed.dirty, false);
    assert.equal(observed.digest, artifact.digest);
    await Effect.runPromise(verifyArtifact(artifact).pipe(Effect.provide(NodeServices.layer)));
    writeFileSync(join(root, 'dist/entry.js'), 'export const value = 2;\n');
    await assert.rejects(Effect.runPromise(verifyArtifact(artifact).pipe(Effect.provide(NodeServices.layer))), /artifact changed during measurement/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/engineering/performance/README.md
test('benchmark archive identity covers its runtime and launches the executable directly', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-bench-archive-'));
  try {
    for (const directory of ['app/dist', 'bin', 'runtime', 'licenses']) mkdirSync(join(root, directory), { recursive: true });
    writeFileSync(join(root, 'app/package.json'), JSON.stringify({ name: 'concord-sdlc', bin: { concord: '../bin/concord' } }));
    writeFileSync(join(root, 'app/dist/build-identity.json'), JSON.stringify({ format: 'concord.build-source/v1', commit: 'a'.repeat(40), dirty: false }));
    writeFileSync(join(root, 'runtime/node'), 'runtime-original');
    const entry = join(root, 'bin/concord');
    writeFileSync(entry, '#!/bin/sh\nprintf archive-executable'); chmodSync(entry, 0o755);
    assert.equal(execFileSync(packageCommand(entry)[0], packageCommand(entry).slice(1), { encoding: 'utf8' }), 'archive-executable');
    const artifact = await Effect.runPromise(loadArtifact('candidate', root, entry).pipe(Effect.scoped, Effect.provide(NodeServices.layer)));
    mkdirSync(join(root, '.in-use')); writeFileSync(join(root, '.in-use/123'), '');
    await Effect.runPromise(verifyArtifact(artifact).pipe(Effect.provide(NodeServices.layer)));
    writeFileSync(join(root, 'runtime/node'), 'runtime-modified');
    await assert.rejects(Effect.runPromise(verifyArtifact(artifact).pipe(Effect.provide(NodeServices.layer))), /artifact changed during measurement/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
