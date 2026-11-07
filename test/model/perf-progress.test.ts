import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { reportFailure, reportVerdict } from '../../scripts/bench.ts';

// @feature docs/engineering/performance/README.md
test('measurement progress emits preparation and sample failures immediately with both observed groups', async () => {
  const messages: string[] = [];
  const write = process.stderr.write;
  process.stderr.write = ((chunk: string) => { messages.push(chunk); return true; }) as typeof write;
  try {
    await Effect.runPromise(reportFailure('local-sdlc/probe', 'baseline', 'cold preparation', 'Help requested'));
    assert.match(messages[0]!, /local-sdlc\/probe: baseline cold preparation FAIL: Help requested/u);
    await Effect.runPromise(reportFailure('local-sdlc/probe', 'candidate', 'sample 2 attempt 1', 'exited 7'));
    assert.match(messages[1]!, /candidate sample 2 attempt 1 FAIL: exited 7/u);
    await Effect.runPromise(reportVerdict({ command: 'local-sdlc/probe', candidate: { samples: [10, 30], p50: 20, max: 30, valid: true }, baseline: { samples: [5, 50], p50: 10, max: 50, valid: false }, pass: false, reasons: ['baseline samples invalid', 'exited 7'] }));
    assert.match(messages[2]!, /candidate p50 20\.0ms max 30\.0ms valid=true; baseline p50 10\.0ms max 50\.0ms valid=false FAIL: baseline samples invalid; exited 7/u);
  } finally { process.stderr.write = write; }
});
