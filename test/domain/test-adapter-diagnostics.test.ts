import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { collectNativeTests } from '../../src/domain/tests/index.ts';
import { OwnedProcess, makeOwnedProcessService, type OwnedProcessResult } from '../../src/base/process/index.ts';
import { ConcordError, RequestSchema, protocolDecode, protocolJson } from '../../src/model/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { LocalRepository, runApplication } from '../support/repository.ts';
import { readProjectConfig, writeProjectConfig } from '../support/support.ts';

// @feature docs/feature/local-sdlc/cli.md#adapter-协议
// @name adapter-failure-invocation-diagnostics
test('adapter collection errors retain invocation states and bounded output tails', async () => {
  const root = createConsumer();
  let repo: LocalRepository | undefined;
  try {
    mkdirSync(join(root, 'test'), { recursive: true });
    writeFileSync(join(root, 'test/sample.ts'), '// sample\n');
    writeFileSync(join(root, 'adapter.ts'), '// external protocol boundary\n');
    writeProjectConfig(root, { ...readProjectConfig(root), testRoots: ['test'], testAdapters: [{ id: 'external', include: ['test'], argv: [process.execPath, 'adapter.ts'], implementationFiles: ['adapter.ts'], inputRoots: [], frameworkVersion: 'fixture/v1', lockFiles: [], envNames: [] }] });
    repo = new LocalRepository(root);
    const stdout = 'discarded prefix\n' + '界'.repeat(30_000) + '\nstdout last line';
    const stderr = 'discarded prefix\n' + 'x'.repeat(70_000) + '\nstderr last line';
    for (const state of [
      { exitCode: 23 },
      { exitCode: null, signal: 'SIGTERM' as const },
      { exitCode: null, timedOut: true },
      { exitCode: null, cancelled: true },
      { outputLimitExceeded: true },
    ]) {
      const owner = {
        ...makeOwnedProcessService({ environment: makeRuntimeEnvironment(root, process.env) }),
        run: (command: readonly string[], options: { readonly stdin?: string }) => Effect.sync((): OwnedProcessResult => {
          const base: OwnedProcessResult = { command, exitCode: 0, signal: null, timedOut: false, cancelled: false, outputLimitExceeded: false, stdout: '', stderr: '', outputBytes: 0, processGroupOwned: false, groupCleanup: { owned: false, checked: false, aliveAfterLeaderClose: null, signalsSent: [], gone: null, detail: 'Simulated external process boundary' } };
          if (options.stdin !== undefined) {
            const request = protocolDecode(RequestSchema, protocolJson(options.stdin));
            return { ...base, stdout: JSON.stringify({ format: request.format, op: request.op, requestId: request.requestId, planId: request.context.planId, inputs: request.context.inputs, payload: { invocations: ['first', 'failed'].map(invocationId => ({ invocationId, argv: [process.execPath, invocationId], cwd: '.', envNames: [], reports: [] })), planContext: {} } }) };
          }
          return command[1] === 'first' ? { ...base, stdout: 'first output', stderr: 'first warning' } : { ...base, ...state, stdout, stderr };
        }),
      };
      await assert.rejects(runApplication(collectNativeTests(repo, ['test/sample.ts']).pipe(Effect.provideService(OwnedProcess, owner))), error => {
        assert.ok(error instanceof ConcordError);
        assert.equal(error.code, 'CollectFailed', error.message);
        const details = error.details as { invocations: readonly Record<string, unknown>[] } | undefined;
        assert.ok(details?.invocations, 'failure must expose invocation diagnostics');
        assert.deepEqual(details.invocations[0], { invocationId: 'first', exitCode: 0, signal: null, timedOut: false, cancelled: false, outputTruncated: false, cleanup: 'complete', stdout: 'first output', stderr: 'first warning' });
        const last = details.invocations[1]!;
        assert.equal(details.invocations.length, 2);
        assert.deepEqual({ ...last, stdout: '', stderr: '' }, { invocationId: 'failed', exitCode: state.exitCode === undefined ? 0 : state.exitCode, signal: state.signal ?? null, timedOut: state.timedOut ?? false, cancelled: state.cancelled ?? false, outputTruncated: state.outputLimitExceeded ?? false, cleanup: 'complete', stdout: '', stderr: '' });
        for (const [key, suffix] of [['stdout', '\nstdout last line'], ['stderr', '\nstderr last line']] as const) {
          assert.equal(typeof last[key], 'string');
          const output = last[key] as string;
          assert.ok(Buffer.byteLength(output) <= 64 * 1024);
          assert.ok(output.endsWith(suffix));
          assert.ok(!output.includes('discarded prefix'));
          assert.ok(!output.includes('\uFFFD'), 'tail starts at a UTF-8 boundary');
        }
        return true;
      });
    }
  } finally { repo?.close(); rmSync(root, { recursive: true, force: true }); }
});
