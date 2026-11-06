import assert from 'node:assert/strict';
import test from 'node:test';
import { commandObservation } from '../../src/domain/tests/evidence.ts';
import type { OwnedProcessResult } from '../../src/base/process/index.ts';

const result = (stdout: string, exitCode = 0): OwnedProcessResult => ({
  command: ['node', '--test'], exitCode, stdout, stderr: '', outputBytes: Buffer.byteLength(stdout),
  signal: null, timedOut: false, cancelled: false, outputLimitExceeded: false, processGroupOwned: true,
  groupCleanup: { owned: true, checked: true, aliveAfterLeaderClose: false, signalsSent: [], gone: true, detail: 'complete' },
});
const counts = (tests: number, pass: number, fail: number, skipped = 0, todo = 0) =>
  `# tests ${tests}\n# pass ${pass}\n# fail ${fail}\n# skipped ${skipped}\n# todo ${todo}\n`;

// @feature docs/feature/local-sdlc/cli.md#测试与修复核验
test('command execution counts use ran and none independently of the exit code', () => {
  const runner = { kind: 'node-test', sourceFiles: [], timeoutMs: 1000 } as const;
  for (const [output, exitCode, execution, commandOutcome] of [
    [counts(1, 1, 0), 0, 'ran', 'pass'],
    [counts(1, 0, 1), 1, 'ran', 'fail'],
    [counts(0, 0, 0), 0, 'none', 'invalid'],
    [counts(1, 0, 0, 1), 0, 'skipped', 'invalid'],
    [counts(1, 0, 0, 0, 1), 0, 'skipped', 'invalid'],
    ['', 0, 'unknown', 'invalid'],
    [counts(2, 1, 0), 0, 'unknown', 'invalid'],
  ] as const) {
    assert.deepEqual(commandObservation(result(output, exitCode), runner), { execution, commandOutcome }, `${output}; exit=${exitCode}`);
  }
  const command = { kind: 'command', argv: ['tool'], sourceFiles: [], timeoutMs: 1000 } as const;
  assert.deepEqual(commandObservation(result('', 0), command), { execution: 'unknown', commandOutcome: 'pass' });
  assert.deepEqual(commandObservation(result('', 2), command), { execution: 'unknown', commandOutcome: 'fail' });
});
