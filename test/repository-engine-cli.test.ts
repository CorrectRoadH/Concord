import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { installConcord, packConcord } from './installed-package.js';
import { evidenceSignature } from '../dist/evidence-policy.js';
import { deriveTestReference } from '../dist/test-reference.js';

const format = 'concord.repository-engine/v1';
const digest = `sha256:${'1'.repeat(64)}`;
const object = Schema.Record(Schema.String, Schema.Unknown);
const decode = <A>(schema: Schema.ConstraintDecoder<A, never>, value: unknown): A => Schema.decodeUnknownSync(schema)(value);
const Envelope = Schema.Struct({
  format: Schema.Literal(format), requestId: Schema.String, op: Schema.String,
  implementationDigest: Schema.String.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/u)), result: Schema.Unknown,
});

// @use-case docs/feature/local-sdlc/use-case/load-compatible-repository-profile.md
test('packed repository engine composes pure governance operations and rejects invalid wire data', () => Effect.runPromise(Effect.sync(() => {
  const scratch = mkdtempSync(join(tmpdir(), 'concord-engine-cli-'));
  try {
    const packed = packConcord(scratch);
    const root = join(scratch, 'consumer');
    mkdirSync(root);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'engine-consumer', private: true, type: 'module' }));
    execFileSync('git', ['init', '-q', root]);
    installConcord(root, packed);
    mkdirSync(join(root, 'acceptance'));
    mkdirSync(join(root, 'docs/feature/example'), { recursive: true });
    writeFileSync(join(root, 'docs/feature/example/README.md'), '# Example contract\n');
    // A configured host must never be imported, even by inventory/sign.
    writeFileSync(join(root, 'host.ts'), "import { writeFileSync } from 'node:fs'; writeFileSync('host-loaded', 'yes'); throw new Error('Host must not load');\n");
    writeFileSync(join(root, 'concord.repository.json'), JSON.stringify({
      format: 'concord.repository/v2', suites: [{ id: 'example', root: 'acceptance' }],
      historyPath: 'case-history.ts', policy: 'concord.native-reliability/v1', host: 'host.ts',
    }));
    const issue = {
      repository: 'owner/repo', number: 1, url: 'https://github.com/owner/repo/issues/1', nodeId: 'issue-1',
      titleDigest: digest, checkedAt: '2026-10-22T00:00:00Z', provenance: 'direct',
    };
    const source = [
      "import { test } from 'node:test';",
      '// @feature docs/feature/example/README.md', '// @regression memory/problem.md',
      `// @issue ${JSON.stringify(issue)}`, '// @test-file acceptance/native.test.ts',
      "test('works', () => {});", "test('unannotated', () => {});", '',
    ].join('\n');
    writeFileSync(join(root, 'acceptance/helper.ts'), source);
    writeFileSync(join(root, 'acceptance/native.test.ts'), '// Native file\n');
    const cli = join(root, 'node_modules/concord-sdlc/dist/entry.js');
    let sequence = 0;
    const invoke = (input: string, status = 0, jsonFlag = true) => {
      const output = spawnSync(process.execPath, [cli, 'repo', 'engine', ...(jsonFlag ? ['--json'] : [])], {
        cwd: root, encoding: 'utf8', input, timeout: 30_000, maxBuffer: 40 * 1024 * 1024,
      });
      assert.equal(output.error, undefined);
      assert.equal(output.status, status, `stdout=${output.stdout}\nstderr=${output.stderr}`);
      if (status === 0) assert.equal(output.stderr, '');
      else {
        assert.equal(output.stdout, '');
        const failure = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ ok: Schema.Literal(false), error: Schema.String, message: Schema.String })))(output.stderr);
        assert.notEqual(failure.error, 'RepositoryToolError');
      }
      return output;
    };
    const call = (op: string, payload: unknown): unknown => {
      const requestId = `engine-${++sequence}`;
      const output = invoke(JSON.stringify({ format, requestId, op, payload }));
      const response = Schema.decodeUnknownSync(Schema.fromJsonString(Envelope), { onExcessProperty: 'error' })(output.stdout);
      assert.equal(response.requestId, requestId);
      assert.equal(response.op, op);
      return response.result;
    };
    const reject = (op: string, payload: unknown) => invoke(JSON.stringify({ format, requestId: 'bad', op, payload }), 1);

    const identity = decode(Schema.Struct({ implementationDigest: Schema.String, adapterDigest: Schema.NullOr(Schema.String) }), call('identity', {}));
    assert.match(identity.implementationDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(identity.adapterDigest, null);
    assert.deepEqual(call('suite', { file: 'acceptance/native.test.ts' }), { id: 'example', root: 'acceptance' });
    const caseId = decode(Schema.String, call('case-id', { nativePath: 'acceptance/native.test.ts', declarationPath: 'acceptance/helper.ts', title: 'works' }));
    assert.match(caseId, /^neref_[a-f0-9]{32}$/u);
    assert.equal(caseId, deriveTestReference('acceptance/native.test.ts', 'acceptance/helper.ts', 'works'));
    assert.equal(call('case-id', { nativePath: 'acceptance/native.test.ts', declarationPath: 'acceptance/helper.ts', title: '' }), deriveTestReference('acceptance/native.test.ts', 'acceptance/helper.ts', ''));
    assert.notEqual(call('case-id', { nativePath: 'acceptance/native.test.ts', declarationPath: 'acceptance/native.test.ts', title: 'works' }), caseId);
    const declarations = decode(Schema.Struct({ annotated: Schema.Array(object), supported: Schema.Array(object) }), call('declarations', { file: 'acceptance/helper.ts', source }));
    const declaration = declarations.annotated[0]!;
    assert.equal(declarations.annotated.length, 1);
    assert.deepEqual(Object.keys(declaration).sort(), ['caseId', 'declarationPath', 'testFile', 'contract', 'contractKind', 'regressions', 'issues', 'title', 'declarationStart', 'annotationStart', 'annotationEnd', 'annotationRanges'].sort());
    assert.equal(declaration.caseId, caseId);
    assert.equal(declaration.testFile, 'acceptance/native.test.ts');
    assert.equal(declaration.declarationPath, 'acceptance/helper.ts');
    assert.equal(declaration.contract, 'docs/feature/example/README.md');
    assert.equal(declaration.contractKind, 'feature');
    assert.deepEqual(declaration.regressions, ['memory/problem.md']);
    assert.deepEqual(declaration.issues, [issue]);
    assert.deepEqual(declarations.supported.map(item => item.title), ['works', 'unannotated']);
    assert.equal(typeof declaration.declarationStart, 'number');
    assert.equal(typeof declaration.annotationStart, 'number');
    assert.equal(typeof declaration.annotationEnd, 'number');
    assert.ok(decode(Schema.Array(Schema.Struct({ start: Schema.Int, end: Schema.Int })), declaration.annotationRanges).length > 0);

    const selector = `acceptance/native.test.ts#${caseId}`;
    const sourceIdentity = decode(object, call('source', { selector }));
    assert.equal(sourceIdentity.caseId, caseId);
    assert.equal(sourceIdentity.declarationFile, 'acceptance/helper.ts');
    assert.deepEqual(call('source-validate', { value: sourceIdentity }), sourceIdentity);
    assert.deepEqual(call('same-source', { left: sourceIdentity, right: sourceIdentity }), { same: true });
    const changedBinding = { ...decode(object, sourceIdentity.binding), contractSha256: 'f'.repeat(64) };
    assert.deepEqual(call('same-source', { left: sourceIdentity, right: { ...sourceIdentity, binding: changedBinding } }), { same: false });
    assert.deepEqual(call('projection', { directory: join(root, 'acceptance'), suiteRoot: 'acceptance' }), sourceIdentity.projection);
    reject('source-validate', { value: { ...sourceIdentity, unexpected: true } });
    const projection = decode(object, sourceIdentity.projection);
    reject('source-validate', { value: { ...sourceIdentity, projection: { ...projection, digest } } });

    const unsignedInventory = {
      executor: { name: 'fixture', version: '1' }, repo: 'example', argv: ['fixture'], checkout: 'fixture',
      files: ['acceptance/native.test.ts'],
      cases: [{ executor: 'fixture', repo: 'example', path: 'acceptance/native.test.ts', titlePath: ['works'], caseId }],
      unassignedCases: [], bodyExecutions: 0, forbiddenSetupExecutions: 0, findings: [], exit: 0, signal: null,
    };
    const inventory = decode(object, call('inventory', { kind: 'case', action: 'sign', value: unsignedInventory }));
    assert.match(decode(Schema.String, inventory.digest), /^sha256:[a-f0-9]{64}$/u);
    assert.equal(inventory.digest, `sha256:${evidenceSignature(unsignedInventory)}`);
    assert.deepEqual(call('inventory', { kind: 'case', action: 'validate', value: inventory }), inventory);
    const unsignedWorkspace = { checkout: 'fixture', repos: [{ id: 'example', receipts: [inventory] }], files: unsignedInventory.files, cases: unsignedInventory.cases, unassignedCases: [], findings: [] };
    const workspace = call('inventory', { kind: 'workspace', action: 'sign', value: unsignedWorkspace });
    assert.equal(decode(object, workspace).digest, `sha256:${evidenceSignature(unsignedWorkspace)}`);
    assert.deepEqual(call('inventory', { kind: 'workspace', action: 'validate', value: workspace }), workspace);
    reject('inventory', { kind: 'case', action: 'validate', value: { ...inventory, digest } });
    reject('inventory', { kind: 'case', action: 'sign', value: inventory });
    reject('inventory', { kind: 'case', action: 'sign', value: { ...unsignedInventory, cases: [...unsignedInventory.cases, ...unsignedInventory.cases] } });
    reject('inventory', { kind: 'workspace', action: 'sign', value: workspace });

    // Complete DTOs here exercise integrity only; they are not formal observations.
    const unsignedReceipt = {
      format: 'concord.native-case-receipt/v1', mode: 'formal', observation: 'red', selector, caseId,
      inventoryDigest: inventory.digest, problem: { path: 'memory/problem.md', epoch: 0 },
      candidate: { gitSha: 'a'.repeat(40), sha256: '2'.repeat(64), sri: `sha256-${Buffer.from('2'.repeat(64), 'hex').toString('base64')}` },
      source: sourceIdentity, runner: { executor: 'fixture', version: '1', implementationDigest: identity.implementationDigest, argv: [] },
      result: { disposition: 'regression', stage: 'test', exitCode: 1, signal: null, timedOut: false, startupFailed: false },
      native: { copyId: 'copy', copyPath: '/fixture', sequence: 1, mode: 'single', caseCount: 1, passed: 0, failed: 1, skipped: 0, retries: 0, parallelism: 1 },
      cleanup: { ok: true, resources: [{ kind: 'fixture', details: { finite: 1 } }] }, invocationId: 'fixture-invocation',
    };
    const receipt = decode(object, call('receipt', { action: 'sign', value: unsignedReceipt }));
    assert.equal(receipt.receiptSha256, evidenceSignature(unsignedReceipt));
    assert.deepEqual(call('receipt', { action: 'validate', value: receipt }), receipt);
    reject('receipt', { action: 'sign', value: receipt });
    reject('receipt', { action: 'validate', value: { ...receipt, receiptSha256: '0'.repeat(64) } });
    reject('receipt', { action: 'sign', value: { ...unsignedReceipt, source: { ...sourceIdentity, extra: true } } });
    reject('receipt', { action: 'sign', value: { ...unsignedReceipt, selector: 'other#case' } });
    const unsignedCertificate = {
      format: 'concord.native-reliability/v1', selector, caseId, candidateSha256: '2'.repeat(64), sourceDigest: decode(object, sourceIdentity.projection).digest,
      greenReceipt: 'receipts/green.json', observations: { isolatedCopies: ['receipts/i1.json', 'receipts/i2.json', 'receipts/i3.json'], sameCopy: ['receipts/s1.json', 'receipts/s2.json'], defaultParallel: 'receipts/p.json', singleCase: 'receipts/green.json', cleanup: [] },
    };
    const certificate = decode(object, call('certificate', { action: 'sign', value: unsignedCertificate }));
    assert.equal(certificate.certificateSha256, evidenceSignature(unsignedCertificate));
    assert.deepEqual(call('certificate', { action: 'validate', value: certificate }), certificate);
    reject('certificate', { action: 'sign', value: certificate });
    reject('certificate', { action: 'validate', value: { ...certificate, certificateSha256: '0'.repeat(64) } });
    const preview = { format: 'concord.change-preview/v1', comparison: { base: 'a'.repeat(40), head: 'b'.repeat(40), mergeBase: 'a'.repeat(40), baseLabel: 'main' }, entries: [] };
    assert.deepEqual(call('preview', { value: preview }), preview);
    reject('preview', { value: { ...preview, extra: true } });

    reject('identity', { extra: true });
    for (const payload of [null, [], ['extra'], true, 0, '']) reject('identity', payload);
    reject('unknown', {});
    invoke(JSON.stringify({ format, requestId: 'extra', op: 'identity', payload: {}, extra: true }), 1);
    invoke('{"format":"concord.repository-engine/v1","requestId":"bad","op":"identity","payload":{},"op":"identity"}', 1);
    invoke(`${JSON.stringify({ format, requestId: 'tail', op: 'identity', payload: {} })}\n{}`, 1);
    invoke('{"format":"concord.repository-engine/v1","requestId":"bad","op":"preview","payload":{"value":1e999}}', 1);
    invoke(JSON.stringify({ format, requestId: 'flag', op: 'identity', payload: {} }), 1, false);
    const nested = JSON.parse(`${'['.repeat(65)}0${']'.repeat(65)}`) as unknown;
    reject('receipt', { action: 'sign', value: { ...unsignedReceipt, cleanup: { ok: true, resources: [{ nested }] } } });
    reject('inventory', { kind: 'case', action: 'sign', value: { ...unsignedInventory, findings: Array.from({ length: 50_001 }, () => 'finding') } });
    const nodeHeavy = Array.from({ length: 40_000 }, () => [1, 2, 3, 4, 5]);
    reject('receipt', { action: 'sign', value: { ...unsignedReceipt, cleanup: { ok: true, resources: [{ nodeHeavy }] } } });
    invoke(' '.repeat(32 * 1024 * 1024 + 1), 1);
    // One title occurs in both annotated and supported output. Input fits the
    // transport budget while the complete response cannot fit it.
    const largeDeclaration = `import { test } from 'node:test';\n// @feature docs/feature/example/README.md\ntest('${'x'.repeat(17 * 1024 * 1024)}', () => {});\n`;
    const oversizedOutput = reject('declarations', { file: 'acceptance/large.test.ts', source: largeDeclaration });
    assert.match(oversizedOutput.stderr, /response exceeds 32 MiB/u);
    assert.equal(existsSync(join(root, 'host-loaded')), false);
    assert.equal(existsSync(join(root, '.concord')), false);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
})));
