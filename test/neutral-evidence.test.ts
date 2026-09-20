import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { LocalRepository, initialize } from '../src/storage.js';
import { createDocument, loadDocuments, resolveMemory, reopenMemory } from '../src/documents.js';
import { deriveTestReference } from '../src/test-reference.js';
import { decode, MemorySchema, type MemoryMeta, type Resolution } from '../src/shared.js';
import { resolvedMemory, reopenedMemory } from '../src/memory-state.js';
import { adoptMemoryEvidenceRequirement, decodeNativeEvidenceIndex, evidenceSignature, validateNativeEvidence, type NativeCaseReceipt, type NativeEvidenceInput, type NativeReliabilityCertificate } from '../src/evidence-policy.js';
import { buildRepositorySourceIdentity, decodeRepositorySourceIdentityV4, sameRepositorySourceIdentity } from '../repository/source-identity.js';

const impl = 'sha256:' + 'b'.repeat(64);
const signReceipt = (receipt: NativeCaseReceipt): NativeCaseReceipt => { const { receiptSha256: _signature, ...unsigned } = receipt; return { ...unsigned, receiptSha256: evidenceSignature(unsigned) }; };
const signCertificate = (certificate: NativeReliabilityCertificate): NativeReliabilityCertificate => { const { certificateSha256: _signature, ...unsigned } = certificate; return { ...unsigned, certificateSha256: evidenceSignature(unsigned) }; };
const memory = (): MemoryMeta => decode(MemorySchema, { format: 'concord.document/v1', kind: 'memory', id: 'problem', title: 'Problem', createdAt: '2026-09-20', memoryKind: 'problem', state: 'open', epoch: 0, promotions: [], history: [] }, 'fixture memory');

const fixture = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-neutral-native-' });
  yield* fs.makeDirectory(join(root, 'quality'), { recursive: true });
  yield* fs.makeDirectory(join(root, 'docs/feature/run'), { recursive: true });
  yield* fs.writeFileString(join(root, 'docs/feature/run/README.md'), '# Run\n');
  yield* fs.writeFileString(join(root, 'concord.repository.json'), JSON.stringify({ format: 'concord.repository/v2', suites: [{ id: 'unit', root: 'quality' }], historyPath: 'governance/history.ts', policy: 'concord.native-reliability/v1' }));
  // Deliberate JavaScript consumer fixture: real Node native test execution.
  const sourceText = `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\n// @feature docs/feature/run/README.md\n// @regression memory/problem.md\ntest('regression', async () => { console.log('NATIVE regression START ' + Date.now()); await new Promise(done => setTimeout(done, 150)); console.log('NATIVE regression END ' + Date.now()); assert.equal(process.env.FIXTURE_BROKEN, 'no'); });\n`;
  const companionText = `import { test } from 'node:test';\n// @feature docs/feature/run/README.md\ntest('companion', async () => { console.log('NATIVE companion START ' + Date.now()); await new Promise(done => setTimeout(done, 150)); console.log('NATIVE companion END ' + Date.now()); });\n`;
  yield* fs.writeFileString(join(root, 'quality/companion.test.mjs'), companionText);
  const file = 'quality/native.test.mjs';
  yield* fs.writeFileString(join(root, file), sourceText);
  const caseId = deriveTestReference(file, file, 'regression');
  const selector = file + '#' + caseId;
  const currentSource = yield* Effect.sync(() => buildRepositorySourceIdentity({ repositoryRoot: root, nativeTestFile: file, caseId }));
  const inventoryUnsigned = { executor: { name: 'node', version: process.version }, repo: 'unit', argv: ['node', '--test'], checkout: '0'.repeat(40), files: [file, 'quality/companion.test.mjs'], cases: [{ executor: 'node', repo: 'unit', path: file, titlePath: ['regression'], caseId }, { executor: 'node', repo: 'unit', path: 'quality/companion.test.mjs', titlePath: ['companion'], caseId: deriveTestReference('quality/companion.test.mjs', 'quality/companion.test.mjs', 'companion') }], unassignedCases: [], bodyExecutions: 0, forbiddenSetupExecutions: 0, findings: [], exit: 0, signal: null };
  const inventory = { ...inventoryUnsigned, digest: 'sha256:' + evidenceSignature(inventoryUnsigned) };
  const context = { selector, problem: { path: 'memory/problem.md', epoch: 0 }, currentSource, implementationDigest: impl, decodeSource: decodeRepositorySourceIdentityV4, sameSource: sameRepositorySourceIdentity };
  const receipt = (id: string, observation: NativeCaseReceipt['observation'], mode: NativeCaseReceipt['native']['mode'], copy: string, sequence = 1): NativeCaseReceipt => signReceipt({
    format: 'concord.native-case-receipt/v1', mode: 'formal', observation, selector, caseId, problem: context.problem, inventoryDigest: inventory.digest,
    candidate: { gitSha: '0'.repeat(40), sha256: (observation === 'red' ? 'a' : 'c').repeat(64), sri: 'sha256-' + Buffer.from((observation === 'red' ? 'a' : 'c').repeat(64), 'hex').toString('base64') }, source: currentSource,
    runner: { executor: 'node', version: process.version, implementationDigest: impl, argv: ['node', '--test'] },
    result: { disposition: observation === 'red' ? 'regression' : 'pass', stage: 'test', exitCode: observation === 'red' ? 1 : 0, signal: null, timedOut: false, startupFailed: false },
    native: { copyId: copy, copyPath: '/fixture/' + copy, sequence, mode, caseCount: 1, passed: observation === 'red' ? 0 : 1, failed: observation === 'red' ? 1 : 0, skipped: 0, retries: 0, parallelism: mode === 'parallel' ? 2 : 1 },
    cleanup: { ok: true, resources: [] }, invocationId: id, receiptSha256: '0'.repeat(64),
  });
  const receipts = new Map<string, NativeCaseReceipt>([
    ['green', receipt('green', 'green', 'single', 'green')], ['i1', receipt('i1', 'reliability', 'isolated', 'i1')], ['i2', receipt('i2', 'reliability', 'isolated', 'i2')], ['i3', receipt('i3', 'reliability', 'isolated', 'i3')], ['s1', receipt('s1', 'reliability', 'same', 'same')], ['s2', receipt('s2', 'reliability', 'same', 'same', 2)], ['parallel', receipt('parallel', 'reliability', 'parallel', 'parallel')],
  ]);
  const certificate = signCertificate({ format: 'concord.native-reliability/v1', selector, caseId, candidateSha256: 'c'.repeat(64), sourceDigest: currentSource.projection.digest, greenReceipt: 'green', observations: { isolatedCopies: ['i1', 'i2', 'i3'], sameCopy: ['s1', 's2'], defaultParallel: 'parallel', singleCase: 'green', cleanup: [...receipts.keys()] }, certificateSha256: '0'.repeat(64) });
  const red = receipt('red', 'red', 'single', 'red');
  return { root, sourceText, companionText, context, inventory, red, receipts, certificate, input: { inventory, red, receipts, certificate } satisfies NativeEvidenceInput };
});

// @feature docs/feature/neutral-project-governance/README.md
test('native validator rejects signed adversarial observations and preserves different red candidate', async () => {
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const f = yield* fixture;
    assert.equal(validateNativeEvidence(f.input, f.context).invocationIds.length, 8);
    const tamper = (name: string, update: (value: NativeCaseReceipt) => NativeCaseReceipt) => {
      const receipts = new Map(f.receipts); receipts.set(name, signReceipt(update(receipts.get(name)!)));
      assert.throws(() => validateNativeEvidence({ ...f.input, receipts }, f.context));
    };
    tamper('green', value => ({ ...value, result: { ...value.result, exitCode: 2 } }));
    tamper('green', value => ({ ...value, candidate: { ...value.candidate, gitSha: 'not-a-git-sha' } }));
    tamper('green', value => ({ ...value, candidate: { ...value.candidate, sri: 'sha256-' + Buffer.from('a'.repeat(64), 'hex').toString('base64') } }));
    tamper('green', value => ({ ...value, result: { ...value.result, timedOut: true } }));
    tamper('green', value => ({ ...value, result: { ...value.result, startupFailed: true } }));
    tamper('green', value => ({ ...value, result: { ...value.result, signal: 'SIGTERM' } }));
    tamper('green', value => ({ ...value, native: { ...value.native, caseCount: 0, passed: 0 } }));
    tamper('green', value => ({ ...value, native: { ...value.native, skipped: 1 } }));
    tamper('green', value => ({ ...value, native: { ...value.native, retries: 1 } }));
    tamper('i2', value => ({ ...value, native: { ...value.native, copyId: 'i1', copyPath: '/fixture/i1' } }));
    tamper('s2', value => ({ ...value, native: { ...value.native, copyId: 'different' } }));
    tamper('s2', value => ({ ...value, native: { ...value.native, sequence: 4 } }));
    tamper('parallel', value => ({ ...value, native: { ...value.native, parallelism: 1 } }));
    tamper('i1', value => ({ ...value, cleanup: { ...value.cleanup, ok: false } }));
    tamper('i1', value => ({ ...value, cleanup: { ok: true, resources: [{ gone: false }] } }));
    tamper('i1', value => ({ ...value, problem: { ...value.problem, epoch: 1 } }));
    tamper('i1', value => ({ ...value, source: { ...f.context.currentSource, binding: { ...f.context.currentSource.binding, configurationDigest: 'sha256:' + 'd'.repeat(64) } } }));
    tamper('i1', value => ({ ...value, source: { ...f.context.currentSource, binding: { ...f.context.currentSource.binding, contractSha256: 'd'.repeat(64) } } }));
    tamper('i1', value => ({ ...value, candidate: { ...value.candidate, sha256: 'd'.repeat(64) } }));
    tamper('i1', value => ({ ...value, invocationId: 'red' }));
    tamper('i1', value => ({ ...value, runner: { ...value.runner, implementationDigest: 'sha256:' + 'd'.repeat(64) } }));
    assert.throws(() => validateNativeEvidence(f.input, { ...f.context, usedInvocations: ['red'] }), /unused/);
    assert.throws(() => validateNativeEvidence(f.input, { ...f.context, implementationDigest: 'sha256:' + 'd'.repeat(64) }), /implementation changed/);
    assert.throws(() => validateNativeEvidence({ ...f.input, certificate: signCertificate({ ...f.certificate, observations: { ...f.certificate.observations, cleanup: ['green'] } }) }, f.context), /cleanup coverage/);
    assert.throws(() => validateNativeEvidence({ ...f.input, red: signReceipt({ ...f.red, result: { ...f.red.result, exitCode: 0 } }) }, f.context), /ordinary regression/);
    assert.throws(() => validateNativeEvidence({ ...f.input, red: { ...f.red, passed: true } }, f.context), /passed/);
    assert.throws(() => decodeNativeEvidenceIndex({ format: 'niceeval.e2e-case-evidence-index/v1', current: {} }, 'legacy'), /offline migration/);
  })).pipe(Effect.provide(NodeServices.layer)));
});

// @feature docs/feature/neutral-project-governance/README.md
test('native gate consumes real Node outcomes from isolated, reused and parallel execution copies', async () => {
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const f = yield* fixture;
    const fs = yield* FileSystem.FileSystem;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const copies = new Map<string, string>();
    const run = Effect.fn('runNativeFixture')(function*(base: NativeCaseReceipt) {
      let copy = copies.get(base.native.copyId);
      if (copy === undefined) {
        copy = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-native-copy-' });
        copies.set(base.native.copyId, copy);
        yield* fs.writeFileString(join(copy, 'native.test.mjs'), f.sourceText);
        if (base.native.mode === 'parallel') yield* fs.writeFileString(join(copy, 'companion.test.mjs'), f.companionText);
      }
      const argv = ['--test', '--test-reporter=tap', '--test-concurrency=' + base.native.parallelism, join(copy, 'native.test.mjs'), ...(base.native.mode === 'parallel' ? [join(copy, 'companion.test.mjs')] : [])];
      const result = yield* Effect.scoped(Effect.gen(function*() {
        const handle = yield* spawner.spawn(ChildProcess.make(process.execPath, argv, { stdout: "pipe", stderr: "pipe", env: { NODE_TEST_CONTEXT: undefined, FIXTURE_BROKEN: base.observation === 'red' ? 'yes' : 'no' }, extendEnv: true }));
        const [chunks, errors, exitCode] = yield* Effect.all([Stream.runCollect(handle.stdout.pipe(Stream.decodeText())), Stream.runCollect(handle.stderr.pipe(Stream.decodeText())), handle.exitCode], { concurrency: 'unbounded' });
        return { output: chunks.join('') + errors.join(''), exitCode: Number(exitCode) };
      }));
      const count = (key: string): number => { const found = new RegExp('^# ' + key + ' (\\d+)$', 'm').exec(result.output); assert.ok(found, result.output); return Number(found[1]); };
      let parallelism = 1;
      if (base.native.mode === 'parallel') {
        const instant = (name: string, event: string): number => { const found = new RegExp('NATIVE ' + name + ' ' + event + ' (\\d+)').exec(result.output); assert.ok(found, result.output); return Number(found[1]); };
        assert.ok(Math.max(instant('regression', 'START'), instant('companion', 'START')) < Math.min(instant('regression', 'END'), instant('companion', 'END')), 'native test observations must actually overlap');
        parallelism = 2;
      }
      return signReceipt({ ...base, runner: { ...base.runner, argv }, result: { ...base.result, exitCode: result.exitCode }, native: { ...base.native, parallelism, copyPath: copy, caseCount: count('tests'), passed: count('pass'), failed: count('fail'), skipped: count('skipped') }, cleanup: { ok: true, resources: [{ processExited: true }] } });
    });
    const red = yield* run(f.red);
    const receipts = new Map<string, NativeCaseReceipt>();
    for (const [path, receipt] of f.receipts) receipts.set(path, yield* run(receipt));
    const validated = validateNativeEvidence({ ...f.input, red, receipts }, f.context);
    assert.equal(validated.red.native.failed, 1);
    assert.equal(validated.green.native.passed, 1);
    assert.equal(validated.reliability[5]!.native.caseCount, 2);
    assert.equal(validated.reliability[5]!.native.parallelism, 2);
    assert.equal(validated.reliability[3]!.native.copyPath, validated.reliability[4]!.native.copyPath);
    assert.equal(new Set(validated.reliability.slice(0, 3).map(value => value.native.copyPath)).size, 3);
  })).pipe(Effect.provide(NodeServices.layer)));
});

// @feature docs/feature/neutral-project-governance/README.md
test('shared lifecycle prevents command downgrade and historical native requirement survives reopen', () => {
  const command: Resolution = { kind: 'fixed', evidenceLevel: 'command', reason: 'fixed', at: 'now', epoch: 0, red: 'r', green: 'g', selectedCaseId: 'c' };
  assert.throws(() => resolvedMemory(adoptMemoryEvidenceRequirement(memory(), 'concord.native-reliability/v1'), command), /requires concord.native/);
  const author: Resolution = { kind: 'not-a-bug', evidenceLevel: 'author', reason: 'not a bug', at: 'now', epoch: 0 };
  const reopened = reopenedMemory(resolvedMemory(adoptMemoryEvidenceRequirement(memory(), 'concord.native-reliability/v1'), author), 'reopen', 'later');
  assert.equal(reopened.evidenceRequirement, 'concord.native-reliability/v1');
  assert.equal(reopened.epoch, 1);
  assert.throws(() => resolvedMemory(reopened, { ...command, epoch: 1 }), /requires concord.native/);
});

// @feature docs/feature/neutral-project-governance/README.md
test('document fixed entry preserves native minimum after deleting policy and CAS rejects policy appearing during creation', async () => {
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-native-policy-' });
    assert.equal(Number(yield* spawner.exitCode(ChildProcess.make('git', ['init', '-q', root]))), 0);
    const repository = yield* Effect.acquireRelease(Effect.sync(() => new LocalRepository(root, { initialize: true })), value => Effect.sync(() => value.close()));
    yield* Effect.sync(() => initialize(repository));
    yield* fs.makeDirectory(join(root, 'quality'));
    const config = JSON.stringify({ format: 'concord.repository/v2', suites: [{ id: 'unit', root: 'quality' }], historyPath: 'governance/history.ts', policy: 'concord.native-reliability/v1' });
    yield* fs.writeFileString(join(root, 'concord.repository.json'), config);
    yield* Effect.sync(() => createDocument(repository, 'memory', { id: 'policy-problem', title: 'Policy Problem', memoryKind: 'problem', body: 'Regression' }));
    assert.equal(decode(MemorySchema, loadDocuments(repository).find(value => value.metadata.id === 'policy-problem')!.metadata, 'problem').evidenceRequirement, 'concord.native-reliability/v1');
    yield* fs.remove(join(root, 'concord.repository.json'));
    assert.throws(() => resolveMemory(repository, 'policy-problem', 'fixed', 'attempt command', { red: 'r', green: 'g', selectedCaseId: 'case', epoch: 0 }), /requires concord.native/);
    yield* Effect.sync(() => resolveMemory(repository, 'policy-problem', 'not-a-bug', 'author adjudication'));
    yield* Effect.sync(() => reopenMemory(repository, 'policy-problem', 'new epoch'));
    assert.throws(() => resolveMemory(repository, 'policy-problem', 'fixed', 'attempt after reopen', { red: 'r', green: 'g', selectedCaseId: 'case', epoch: 1 }), /requires concord.native/);
    // An external editor writes at the publication boundary, after policy selection.
    const original = repository.publish.bind(repository);
    repository.publish = (operation, changes, dryRun) => { writeFileSync(join(root, 'concord.repository.json'), config); return original(operation, changes, dryRun); };
    try { assert.throws(() => createDocument(repository, 'memory', { id: 'racy', title: 'Racy', memoryKind: 'problem', body: 'Race' }), /changed/); }
    finally { repository.publish = original; }
    assert.equal(yield* fs.exists(join(root, 'memory/racy.md')), false);
  })).pipe(Effect.provide(NodeServices.layer)));
});
