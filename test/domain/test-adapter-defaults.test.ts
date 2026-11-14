import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { makeOwnedProcessService, OwnedProcess, type OwnedProcessOptions, type OwnedProcessResult } from '../../src/base/process/index.ts';
import { parseTypeScriptConfig } from '../../src/base/workspace/index.ts';
import { adapterInputSnapshot, collectNativeTests, readNativeObservations, readReports } from '../../src/domain/tests/index.ts';
import { RequestSchema, TestAdapterSchema, protocolDecode, protocolJson, type config_public_TestAdapter as PublicAdapter } from '../../src/model/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { LocalRepository, runApplication } from '../support/repository.ts';

const capabilities = { realCollection: true, leaf: true, parameterGroups: false, range: false, rangeTrivia: false, tags: false };
const complete = (command: readonly string[], stdout = ''): OwnedProcessResult => ({ command, exitCode: 0, signal: null, timedOut: false, cancelled: false, outputLimitExceeded: false, stdout, stderr: '', outputBytes: Buffer.byteLength(stdout), processGroupOwned: false, groupCleanup: { owned: false, checked: false, aliveAfterLeaderClose: null, signalsSent: [], gone: null, detail: 'External tool boundary has no OS process' } });

// @use-case docs/feature/local-sdlc/use-case/collect-native-tests.md#configure
test('the documented minimum builtin config decodes and collects with observed versions and no forwarded environment', async () => {
  const root = await createConsumer();
  let repo: LocalRepository | undefined;
  const calls: { command: readonly string[]; options: OwnedProcessOptions }[] = [];
  try {
    const minimal: PublicAdapter = { id: 'go', include: ['test/cart'], builtin: 'go' };
    const source = `export default ${JSON.stringify({ testRoots: ['test'], testAdapters: [minimal] })};`;
    const config = await parseTypeScriptConfig(source);
    const adapter = config.testAdapters![0]!;
    for (const field of ['implementationFiles', 'inputRoots', 'lockFiles', 'envNames'] as const) assert.deepEqual(adapter[field], []);
    assert.equal(adapter.frameworkVersion, undefined);
    assert.throws(() => protocolDecode(TestAdapterSchema, { ...minimal, runTimeoutMs: 1000 }), { code: 'AdapterProtocolInvalid' });
    mkdirSync(join(root, 'test/cart'), { recursive: true });
    mkdirSync(join(root, 'tools'));
    writeFileSync(join(root, 'tools/go'), 'external Go executable fixture');
    writeFileSync(join(root, 'test/cart/cart_test.go'), 'package cart\nimport "testing"\nfunc TestAddItem(t *testing.T) { panic("must not execute") }\n');
    writeFileSync(join(root, 'concord.config.ts'), source);
    const environment = { ...process.env, PATH: `${join(root, 'tools')}${delimiter}${process.env.PATH ?? ''}` };
    repo = await LocalRepository.open(root, { environment });
    const owner = { ...makeOwnedProcessService({ environment: makeRuntimeEnvironment(root, environment) }), run: (command: readonly string[], options: OwnedProcessOptions) => Effect.sync(() => {
      calls.push({ command, options });
      return complete(command, command[1] === 'version' ? 'go version go1.26.10 darwin/arm64\n' : 'TestAddItem\nok\tfixture/cart\t0.001s\n');
    }) };
    const result = await runApplication(collectNativeTests(repo, ['test/cart/cart_test.go']).pipe(Effect.provideService(OwnedProcess, owner)));
    const collected = result.observations[0]!;
    assert.equal(collected.inputScope.versions.framework, 'go1.26.10');
    assert.equal(collected.inputScope.versions.observedFramework, 'go version go1.26.10 darwin/arm64');
    assert.equal(collected.observation.value.cases[0]!.nativeId, 'go:go:test/cart:test/cart/cart_test.go:TestAddItem');
    assert.equal(collected.observation.value.cases[0]!.provenance, 'go/go1.26.10');
    assert.ok(collected.observation.gaps.includes('GoDynamicSubtestsUnknown'));
    assert.equal(readNativeObservations(repo)[0]!.observation.current, true);
    assert.deepEqual(calls.map(item => item.command.slice(1)), [['version'], ['test', '-list', '^Test', '.']]);
    for (const call of calls) {
      assert.equal(call.command[0], join(root, 'tools/go'));
      assert.deepEqual(call.options.env, {});
    }
  } finally { repo?.close(); rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/feature/local-sdlc/cli.md#原生测试-adapter
test('an omitted implementation list still captures an ignored local argv entry and missing declared inputs still fail', async () => {
  const root = await createConsumer();
  let repo: LocalRepository | undefined;
  try {
    mkdirSync(join(root, 'adapters'));
    writeFileSync(join(root, 'adapters/collect.ts'), '// entry one\n');
    writeFileSync(join(root, 'concord.config.ts'), `export default ${JSON.stringify({ testRoots: ['test'], sourceIgnore: ['adapters'], testAdapters: [{ id: 'external', include: ['test'], argv: [process.execPath, './adapters/collect.ts', 'adapters'] }] })};`);
    repo = await LocalRepository.open(root);
    let snapshot = repo.snapshot(() => adapterInputSnapshot(repo!, repo!.config.testAdapters![0]!));
    assert.ok(snapshot.members.some(item => item.path === 'adapters/collect.ts'));
    assert.ok(!snapshot.members.some(item => item.path === 'adapters'), 'directory operands are not regular-file inputs');
    assert.throws(() => repo!.snapshot(() => adapterInputSnapshot(repo!, { ...repo!.config.testAdapters![0]!, implementationFiles: ['adapters/missing.ts'] })), { code: 'CollectFailed' });
    const before = snapshot.inputs;
    repo.close(); repo = undefined;
    writeFileSync(join(root, 'adapters/collect.ts'), '// entry two\n');
    repo = await LocalRepository.open(root);
    snapshot = repo.snapshot(() => adapterInputSnapshot(repo!, repo!.config.testAdapters![0]!));
    assert.notEqual(snapshot.inputs, before);
  } finally { repo?.close(); rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/feature/local-sdlc/cli.md#原生测试-adapter
test('an explicit builtin version is enforced before collection instead of becoming a fabricated observation', async () => {
  const root = await createConsumer();
  let repo: LocalRepository | undefined;
  try {
    mkdirSync(join(root, 'test'));
    writeFileSync(join(root, 'test/sample.ts'), '// sample\n');
    writeFileSync(join(root, 'concord.config.ts'), `export default ${JSON.stringify({ testRoots: ['test'], testAdapters: [{ id: 'node', include: ['test'], builtin: 'node-test', frameworkVersion: '0.0.0' }] })};`);
    mkdirSync(join(root, 'tools'));
    writeFileSync(join(root, 'tools/node'), 'external Node executable fixture');
    const environment = { ...process.env, PATH: `${join(root, 'tools')}${delimiter}${process.env.PATH ?? ''}` };
    // The version process is the external boundary; request selection and
    // mismatch rejection remain the real collection implementation.
    repo = await LocalRepository.open(root, { environment });
    const seen: string[][] = [];
    const owner = { ...makeOwnedProcessService({ environment: makeRuntimeEnvironment(root, environment) }), run: (command: readonly string[]) => Effect.sync(() => { seen.push([...command]); return complete(command, 'v26.5.0\n'); }) };
    await assert.rejects(runApplication(collectNativeTests(repo, ['test/sample.ts']).pipe(Effect.provideService(OwnedProcess, owner))), { code: 'CollectFailed' });
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0]!.slice(1), ['--version']);
    assert.deepEqual(readNativeObservations(repo), []);
  } finally { repo?.close(); rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/feature/local-sdlc/cli.md#原生测试-adapter
test('a minimal external adapter records unknown framework and runtime versions with gaps', async () => {
  const root = await createConsumer();
  let repo: LocalRepository | undefined;
  try {
    mkdirSync(join(root, 'test'));
    writeFileSync(join(root, 'test/sample.ts'), '// sample\n');
    writeFileSync(join(root, 'adapter.ts'), '// external protocol entry\n');
    writeFileSync(join(root, 'concord.config.ts'), `export default ${JSON.stringify({ testRoots: ['test'], testAdapters: [{ id: 'external', include: ['test'], argv: [process.execPath, 'adapter.ts'] }] })};`);
    repo = await LocalRepository.open(root);
    const owner = { ...makeOwnedProcessService({ environment: makeRuntimeEnvironment(root, process.env) }), run: (command: readonly string[], options: OwnedProcessOptions) => Effect.sync(() => {
      if (options.stdin === undefined) return complete(command);
      const request = protocolDecode(RequestSchema, protocolJson(options.stdin));
      const payload = request.op === 'collect-plan' ? { invocations: [{ invocationId: 'collect', argv: [process.execPath, 'adapter.ts', 'collect'], cwd: '.', envNames: [], reports: [] }], planContext: {} } : { cases: [], capabilities, completeness: { complete: true, gaps: [] } };
      return complete(command, JSON.stringify({ format: request.format, op: request.op, requestId: request.requestId, planId: request.context.planId, inputs: request.context.inputs, payload }));
    }) };
    const result = await runApplication(collectNativeTests(repo, ['test/sample.ts']).pipe(Effect.provideService(OwnedProcess, owner)));
    assert.deepEqual(result.observations[0]!.inputScope.versions, { framework: 'unknown', runtime: 'unknown' });
    assert.ok(result.observations[0]!.observation.gaps.includes('FrameworkVersionUnavailable'));
    assert.ok(result.observations[0]!.observation.gaps.includes('RuntimeVersionUnavailable'));
  } finally { repo?.close(); rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/feature/local-sdlc/architecture.md#原生-adapter
test('empty artifact declarations bypass a nonexistent directory while nonempty paths retain validation', async () => {
  const adapter = protocolDecode(TestAdapterSchema, { id: 'external', include: ['test'], argv: ['adapter'] });
  const budget = { files: 0, bytes: 0 };
  assert.deepEqual(await runApplication(readReports('/does-not-exist', [], adapter, budget)), []);
  assert.deepEqual(budget, { files: 0, bytes: 0 });
  await assert.rejects(runApplication(readReports('/does-not-exist', ['../escape'], adapter, budget)), { code: 'ReportUnsafe' });
});
