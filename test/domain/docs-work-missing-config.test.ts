import assert from 'node:assert/strict';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { fixture } from '../support/docs-work-fixture.ts';
import { prepare, show } from '../support/docs-work-domain-fixture.ts';

// @use-case docs/feature/neutral-project-governance/use-case/coordinate-docs-work.md
// @issue docs/issues/docs-work-missing-config.md
test('docs work plans with default settings without creating a project configuration', () => Effect.runPromise(Effect.tryPromise(async () => {
  // The absent project configuration is the initial state under test.
  const root = fixture(undefined, false);
  try {
    const result = await prepare(root, { scopes: ['docs/a/'], runId: 'no-config' });
    assert.equal(result.operation, 'docs-work-prepare');
    assert.equal((await show(root, 'no-config')).runId, 'no-config');
    assert.equal(existsSync(join(root, 'concord.config.ts')), false);
    writeFileSync(join(root, 'concord.config.ts'), 'export default {};\n');
    const appeared = await prepare(root, { scopes: ['docs/b/'], runId: 'with-config' });
    assert.equal(appeared.operation, 'docs-work-prepare');
  } finally { rmSync(root, { recursive: true, force: true }); }
})));
