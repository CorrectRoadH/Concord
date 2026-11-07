import assert from 'node:assert/strict';
import test from 'node:test';
import { observeOwnedProcessGroup } from '../../src/base/process/index.ts';

// @use-case docs/feature/local-sdlc/use-case/analyze-other-languages.md
// @issue docs/issues/lsp-fixture-cleanup-flaky.md
test('Linux group observation ignores ESRCH when an enumerated proc task exits before its stat is read', () => {
  for (const [state, expected] of [['Z', 'zombie-only'], ['S', 'alive']] as const) {
    assert.equal(observeOwnedProcessGroup(42, {
      platform: 'linux',
      kill: () => undefined,
      procEntries: () => ['1', '2'],
      procStat: pid => {
        if (pid === '1') return `1 (worker) ${state} 0 42 42 0`;
        // Linux returns ESRCH when a proc stat FD outlives its process.
        throw Object.assign(new Error('No such process'), { code: 'ESRCH' });
      },
    }), expected);
  }
});
