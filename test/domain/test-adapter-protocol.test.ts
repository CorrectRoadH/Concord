import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { collectNativeTests, readNativeObservations } from '../../src/app/index.ts';
import { OwnedProcess, makeOwnedProcessService, type OwnedProcessResult } from '../../src/base/process/index.ts';
import { RequestSchema, digest, protocolDecode, protocolJson } from '../../src/model/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { createDocument } from '../support/operations.ts';
import { LocalRepository, runApplication } from '../support/repository.ts';
import { readProjectConfig, writeProjectConfig } from '../support/support.ts';

const capabilities = { realCollection: true, leaf: true, parameterGroups: true, exactSelection: true, perItemReport: true, range: true, rangeTrivia: true, tags: true, skipVisibility: true };
const source = '// @feature docs/feature/example/README.md\n// @name parameter-group\n// @issue docs/issues/problem.md\n';

for (const mode of ['green', 'wrong-echo', 'extra-envelope'] as const) {
  // @use-case docs/feature/local-sdlc/use-case/run-native-test-adapters.md#约束
  test(`real adapter consumer validates ${mode} response and observation publication`, async () => {
    const root = (await createConsumer());
    let repo: LocalRepository | undefined;
    try {
      const initial = (await LocalRepository.open(root));
      try {
        (await createDocument(initial, 'feature', { id: 'example', title: 'Example' }));
        (await createDocument(initial, 'issue', { id: 'problem', title: 'Problem' }));
      } finally { initial.close(); }
      mkdirSync(join(root, 'test'), { recursive: true });
      writeFileSync(join(root, 'test/sample.ts'), source);
      copyFileSync(new URL('../fixtures/process-adapter.ts', import.meta.url), join(root, 'adapter.ts'));
      writeFileSync(join(root, 'fixture.txt'), 'original');
      writeFileSync(join(root, 'fixture.lock'), 'locked');
      writeProjectConfig(root, { ...(await readProjectConfig(root)), testRoots: ['test'], testAdapters: [{ id: 'external', include: ['test'], argv: [process.execPath, 'adapter.ts'], implementationFiles: ['adapter.ts'], inputRoots: [], frameworkVersion: 'fixture/v1', lockFiles: ['fixture.lock'], envNames: ['NODE_OPTIONS', 'PATH'], collectTimeoutMs: 1000, budgets: { reportFileBytes: 128 } }] });
      repo = (await LocalRepository.open(root));
      // Only external process bytes are simulated; the application owns request
      // identity, strict response decoding, publication and session cleanup.
      const owner = {
        ...makeOwnedProcessService({ environment: makeRuntimeEnvironment(root, process.env) }),
        run: (command: readonly string[], options: { readonly stdin?: string }) => Effect.sync((): OwnedProcessResult => {
          let stdout = '';
          if (options.stdin !== undefined) {
            const request = protocolDecode(RequestSchema, protocolJson(options.stdin));
            const payload = request.op === 'collect-plan'
              ? { invocations: [{ invocationId: 'collect', argv: [process.execPath, 'adapter.ts', 'invoke', 'collect'], cwd: '.', envNames: ['PATH'], reports: [] }], planContext: { files: ['test/sample.ts'] } }
              : { cases: ['fake:binary-a:one', 'fake:binary-b:two'].map(nativeId => ({ nativeId, project: 'fixture', file: 'test/sample.ts', kind: 'leaf', group: 'parameters', range: { startLine: 1, endLine: source.split(/\r?\n/u).length, sourceDigest: digest(source) }, selection: { opaqueId: nativeId, capabilityVersion: 'fixture/v1' }, tags: { tag: 'not-a-relation' }, provenance: 'fixture/v1' })), capabilities, completeness: { complete: true, gaps: [] } };
            stdout = JSON.stringify({ format: request.format, op: request.op, requestId: request.requestId, planId: request.context.planId, inputs: mode === 'wrong-echo' ? `sha256:${'0'.repeat(64)}` : request.context.inputs, payload, ...(mode === 'extra-envelope' ? { unknown: true } : {}) }) + '\n';
          }
          return { command, exitCode: 0, signal: null, timedOut: false, cancelled: false, outputLimitExceeded: false, stdout, stderr: '', outputBytes: Buffer.byteLength(stdout), processGroupOwned: false, groupCleanup: { owned: false, checked: false, aliveAfterLeaderClose: null, signalsSent: [], gone: null, detail: 'External protocol fixture has no OS process' } };
        }),
      };
      const collect = () => runApplication(collectNativeTests(repo!, ['test/sample.ts']).pipe(Effect.provideService(OwnedProcess, owner)));
      if (mode === 'green') {
        const result = await collect();
        assert.deepEqual(result.observations[0]!.observation.value.cases.map(item => item.nativeId), ['fake:binary-a:one', 'fake:binary-b:two']);
        assert.deepEqual(readNativeObservations(repo).map(item => item.adapterId), ['external']);
      } else {
        await assert.rejects((collect()), { code: 'AdapterProtocolInvalid' }, mode);
        assert.deepEqual(readNativeObservations(repo), [], 'Rejected envelopes cannot publish a current inventory');
      }
      assert.equal(readFileSync(join(root, 'test/sample.ts'), 'utf8'), source);
      assert.equal(readFileSync(join(root, 'fixture.txt'), 'utf8'), 'original');
      assert.equal(readFileSync(join(root, 'fixture.lock'), 'utf8'), 'locked');
    } finally { repo?.close(); rmSync(root, { recursive: true, force: true }); }
  });
}
