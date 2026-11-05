import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect } from 'effect';
import { loadArtifact, verifyArtifact } from '../../scripts/perf/artifact.js';
import { tmpdir } from '../support/temporary.js';

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
