import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { requireInitializedProject, projectInitializationRequired, uninitializedDoctor } from '../../src/app/index.ts';
import { tmpdir } from '../support/temporary.ts';

// @use-case docs/feature/project-onboarding/use-case/open-uninitialized-repo.md#cli
test('initialization requires taste and derives the writing guide from tracked and unignored files', () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-initialization-domain-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    for (const path of ['README.md', 'AGENTS.md', 'LICENSE', 'concord.config.ts', '.gitignore']) writeFileSync(join(root, path), path === '.gitignore' ? 'ignored.ts\n' : '');
    writeFileSync(join(root, 'ignored.ts'), 'ignored');
    mkdirSync(join(root, 'docs')); writeFileSync(join(root, 'docs/draft.md'), '# Draft');
    const required = projectInitializationRequired(root)!;
    assert.deepEqual(required, { root, guide: 'docs-from-scratch' });
    const result = Effect.runSync(Effect.result(requireInitializedProject(root)));
    assert.equal(result._tag, 'Failure');
    if (result._tag === 'Failure') { assert.equal(result.failure.code, 'ProjectNotInitialized'); assert.deepEqual(result.failure.details, required); }
    const doctor = uninitializedDoctor(required, 'test-runtime');
    assert.equal(doctor.ok, true);
    assert.deepEqual(doctor.nextSteps, ['concord init', 'concord --skill docs-from-scratch']);
    writeFileSync(join(root, 'code.ts'), 'export {};');
    assert.equal(projectInitializationRequired(root)?.guide, 'docs-from-code');
    execFileSync('git', ['-C', root, 'add', 'code.ts']);
    writeFileSync(join(root, '.gitignore'), 'ignored.ts\ncode.ts\n');
    assert.equal(projectInitializationRequired(root)?.guide, 'docs-from-code');
    writeFileSync(join(root, 'docs/taste.md'), '');
    assert.equal(projectInitializationRequired(root), undefined);
    Effect.runSync(requireInitializedProject(root));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/web-workbench/use-case/review-pull-request.md
test('preview initialization checks use the Git top for a nested root without relaxing project command roots', () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-initialization-preview-'));
  const nested = join(root, 'docs/nested');
  try {
    execFileSync('git', ['init', '-q', root]);
    mkdirSync(nested, { recursive: true });
    assert.deepEqual(projectInitializationRequired(nested, true), { root, guide: 'docs-from-scratch' });
    assert.throws(() => projectInitializationRequired(nested), error => error instanceof Error && 'code' in error && error.code === 'ProjectRootInvalid');
    writeFileSync(join(root, 'docs/taste.md'), '');
    assert.equal(projectInitializationRequired(nested, true), undefined);
    Effect.runSync(requireInitializedProject(nested, true));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
