import assert from 'node:assert/strict';
import test from 'node:test';
import { humanOutput } from '../../src/entry/cli/index.js';

// @feature docs/feature/local-sdlc/README.md
test('human mutation hints follow the operation and camelCase labels remain intact', () => {
  const created = humanOutput({ operation: 'create-memory', dryRun: false, changedPaths: ['memory/one.md'] });
  const edited = humanOutput({ operation: 'set-author', dryRun: false, changedPaths: ['memory/one.md'] });
  for (const operation of ['remove-issue', 'link-issue', 'close-issue', 'set-author']) {
    const output = humanOutput({ operation, dryRun: false, changedPaths: ['docs/issues/one.md'] });
    assert.match(output, /Next: concord check\./u);
    assert.doesNotMatch(output, /edit the author prose/u);
  }
  assert.match(created, /Next: edit the author prose, then run concord check\./u);
  assert.match(edited, /Next: concord check\./u);
  assert.doesNotMatch(humanOutput({ operation: 'remove-issue', dryRun: true, changedPaths: ['docs/issues/one.md'] }), /Next:/u);
  const labels = humanOutput({ operation: 'trace-show', createdAt: 'today', memoryKind: 'note', codeDeclarations: [], memoryRelations: [] });
  for (const key of ['createdAt', 'memoryKind', 'codeDeclarations', 'memoryRelations']) assert.match(labels, new RegExp(`${key}:`, 'u'));
  assert.doesNotMatch(labels, /created At|memory Kind|code Declarations|memory Relations/u);
});
