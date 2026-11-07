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

// @feature docs/engineering/performance/README.md
test('benchmark archive identity covers bundled ripgrep and the executable launched directly', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-bench-archive-'));
  try {
    for (const directory of ['app/dist', 'bin', 'runtime', 'licenses']) mkdirSync(join(root, directory), { recursive: true });
    writeFileSync(join(root, 'app/package.json'), JSON.stringify({ name: 'concord-sdlc', bin: { concord: '../bin/concord' } }));
    writeFileSync(join(root, 'app/dist/build-identity.json'), JSON.stringify({ format: 'concord.build-source/v1', commit: 'a'.repeat(40), dirty: false }));
    writeFileSync(join(root, 'runtime/rg'), 'runtime-original');
    const entry = join(root, 'bin/concord');
    writeFileSync(entry, '#!/bin/sh\nprintf archive-executable'); chmodSync(entry, 0o755);
    assert.equal(execFileSync(packageCommand(entry)[0], packageCommand(entry).slice(1), { encoding: 'utf8' }), 'archive-executable');
    const artifact = await Effect.runPromise(loadArtifact('candidate', root, entry).pipe(Effect.scoped, Effect.provide(NodeServices.layer)));
    mkdirSync(join(root, '.in-use')); writeFileSync(join(root, '.in-use/123'), '');
    await Effect.runPromise(verifyArtifact(artifact).pipe(Effect.provide(NodeServices.layer)));
    writeFileSync(join(root, 'runtime/rg'), 'runtime-modified');
    await assert.rejects(Effect.runPromise(verifyArtifact(artifact).pipe(Effect.provide(NodeServices.layer))), /artifact changed during measurement/u);
    writeFileSync(join(root, 'runtime/rg'), 'runtime-original');
    await Effect.runPromise(verifyArtifact(artifact).pipe(Effect.provide(NodeServices.layer)));
    writeFileSync(entry, '#!/bin/sh\nprintf changed-executable');
    await assert.rejects(Effect.runPromise(verifyArtifact(artifact).pipe(Effect.provide(NodeServices.layer))), /artifact changed during measurement/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
