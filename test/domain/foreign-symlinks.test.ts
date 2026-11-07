import assert from 'node:assert/strict';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { checkProject } from '../../src/app/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { LocalRepository } from '../support/repository.ts';

// @feature docs/feature/local-sdlc/architecture.md#路径安全
test('check ignores foreign skill and CLAUDE symlinks while rejecting owner and Concord skill symlinks', async () => (await Effect.runPromise(Effect.tryPromise(async () => {
  const root = (await createConsumer());
  const repo = (await LocalRepository.open(root, { dryRun: true, persistentCache: 'off' }));
  const link = (target: string, path: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    symlinkSync(target, join(root, path));
  };
  try {
    const before = (await repo.snapshot(async () => (await checkProject(repo, 'off'))));
    link('AGENTS.md', 'CLAUDE.md');
    mkdirSync(join(root, '.agents/skills/effect-ts'), { recursive: true });
    writeFileSync(join(root, '.agents/skills/effect-ts/SKILL.md'), 'foreign skill');
    link('../../.agents/skills/effect-ts', '.claude/skills/effect-ts');
    link('missing-target', '.agents/skills/broken');
    link('missing-target', '.agents/skills/effect-ts/nested');
    assert.deepEqual((await repo.snapshot(async () => (await checkProject(repo, 'off')))), before);

    for (const path of ['.claude/skills/concord-spec', '.agents/skills/concord-retired', '.agents/skills/concord-fix/nested', 'docs/foreign.md']) {
      rmSync(join(root, path), { recursive: true, force: true });
      link('missing-target', path);
      (await assert.rejects(async () => (await repo.snapshot(async () => (await checkProject(repo, 'off')))), { code: 'UnsafePath' }, path));
      rmSync(join(root, path));
    }
  } finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
}))));
