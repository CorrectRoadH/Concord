import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commandObservation } from "../../src/domain/tests/index.ts";
import { type OwnedProcessResult } from "../../src/base/process/index.ts";

const normal: OwnedProcessResult = { command: ['node'], exitCode: 1, signal: null, timedOut: false, cancelled: false, outputLimitExceeded: false, stdout: '', stderr: '', outputBytes: 0, processGroupOwned: true, groupCleanup: { owned: true, checked: true, aliveAfterLeaderClose: false, signalsSent: [], gone: true, detail: 'gone' } };
const runner = { kind: 'command' as const, argv: ['node'] as [string], sourceFiles: [], timeoutMs: 1000 };
// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#边界
test('unknown command counts express command failure without inventing case coverage', () => {
  assert.deepEqual(commandObservation(normal, runner), { commandOutcome: 'fail', execution: 'unknown' });
  assert.deepEqual(commandObservation({ ...normal, exitCode: 0 }, runner), { commandOutcome: 'pass', execution: 'unknown' });
});
// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#结果
test('runner abnormal or unconfirmed cleanup results never qualify as red or green', () => {
  for (const patch of [
    { cancelled: true }, { timedOut: true }, { signal: 'SIGTERM' as const }, { outputLimitExceeded: true }, { error: 'spawn failed' },
    { groupCleanup: { ...normal.groupCleanup, gone: null } }, { exitCode: null },
  ]) for (const exitCode of [0, 1]) assert.deepEqual(commandObservation({ ...normal, exitCode, ...patch }, runner), { commandOutcome: 'invalid', execution: 'unknown' });
  for (const [stdout, execution] of [
    ['# tests 0\n# pass 0\n# fail 0\n# skipped 0\n# todo 0\n', 'none'],
    ['# tests 2\n# pass 0\n# fail 0\n# skipped 1\n# todo 1\n', 'skipped'],
  ] as const) assert.deepEqual(commandObservation({ ...normal, stdout }, runner), { commandOutcome: 'invalid', execution });
});
