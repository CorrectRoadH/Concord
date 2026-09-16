import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { createDocument } from '../dist/documents.js';
import { LocalRepository, initialize } from '../dist/storage.js';

// @use-case docs/feature/project-onboarding/use-case/inherit-template-defaults.md
test('project defaults apply once and explicit empty pages remain README-only', () => Effect.runPromise(Effect.sync(() => {
  const root = mkdtempSync(join(tmpdir(), 'concord-default-pages-'));
  let repo: LocalRepository | undefined;
  try {
    execFileSync('git', ['init', '-q', root]);
    repo = new LocalRepository(root, { initialize: true });
    initialize(repo, false, { projectTypes: ['library', 'cli'] });
    const inherited = createDocument(repo, 'feature', { id: 'inherited', title: 'Inherited' });
    assert.ok(inherited.changedPaths.includes('docs/feature/inherited/library.md'));
    assert.ok(inherited.changedPaths.includes('docs/feature/inherited/cli.md'));
    const minimal = createDocument(repo, 'feature', { id: 'minimal', title: 'Minimal', pages: [] });
    assert.deepEqual(minimal.changedPaths, ['docs/feature/minimal/README.md']);
  } finally { repo?.close(); rmSync(root, { recursive: true, force: true }); }
})));
