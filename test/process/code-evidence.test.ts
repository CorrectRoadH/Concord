import { createDocument } from '../support/operations.ts';
import { createConsumer } from '../support/consumer.ts';
import { LocalRepository } from '../support/repository.ts';
import type { DocumentKind } from '../../src/model/index.ts';
import type { CreateDocumentInput } from '../../src/app/index.ts';
import { packageBin } from '../support/installed-package.ts';
import { sourceConcord, prepareSourceConsumer } from '../support/installed-package.ts';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { CodeDeclarationSchema } from "../../src/model/index.ts";
import { ProjectSchema } from "../../src/model/index.ts";
import { readProjectConfig, writeProjectConfig } from '../support/support.ts';
import { caseDiscriminator, deriveTestReference } from "../../src/model/index.ts";

// @use-case docs/feature/local-sdlc/use-case/trace-code-ownership.md
test('code findings preserve real red and green test execution and original reference validation', () => Effect.runPromise(Effect.sync(() => {
  const scratch = mkdtempSync(join(tmpdir(), 'concord-code-cli-'));
  try {
    const packed = sourceConcord();
    assert.ok(packed);
    const install = join(scratch, 'tool'); mkdirSync(install);
    writeFileSync(join(install, 'package.json'), JSON.stringify({ private: true }));
    prepareSourceConsumer(install, packed);
    const cli = packageBin(join(install, 'node_modules/concord-sdlc'));
    const root = createConsumer();
    writeProjectConfig(root, { sourceRoots: ['src', 'test'], testRoots: [] });
    const repo = new LocalRepository(root);
    try {
      createDocument(repo, 'feature', { id: 'orders', title: 'Orders' });
      createDocument(repo, 'use-case', { id: 'create-order', title: 'Create order', feature: 'orders' });
    } finally { repo.close(); }
    mkdirSync(join(root, 'src')); mkdirSync(join(root, 'test'));
    const useCase = 'docs/feature/orders/use-case/create-order.md';
    const config = readProjectConfig(root), ack = Schema.Struct({}), error = Schema.Struct({ error: Schema.String });
    function call<A>(args: readonly string[], schema: Schema.ConstraintDecoder<A, never>, status = 0): A {
      const result = spawnSync(process.execPath, [cli, '--root', root, '--json', '--fresh', ...args], { encoding: 'utf8', timeout: 30000 });
      assert.equal(result.status, status, JSON.stringify({ args, status: result.status, signal: result.signal, error: result.error, stdout: result.stdout, stderr: result.stderr }));
      return Schema.decodeUnknownSync(Schema.fromJsonString(schema))(result.stdout.trim() || result.stderr.trim());
    }
    // A code finding must not become an extra precondition for real red/green evidence.
    call(['new', 'issue', 'wrong-result', '--title', 'Wrong result'], ack);
    const problem = 'docs/issues/wrong-result.md';
    writeProjectConfig(root, { ...config, testRoots: ['test'], runner: { kind: 'node-test', sourceFiles: [], timeoutMs: 5000 } });
    writeFileSync(join(root, 'test/result.test.mjs'), [
      "import test from 'node:test';", "import assert from 'node:assert/strict';", "import { result } from '../src/result.mjs';",
      `// @use-case ${useCase}`, `// @issue ${problem}`,
      "test('result', () => { assert.equal(result(), 2); });", '',
    ].join('\n'));
    const resultCase = deriveTestReference('test/result.test.mjs', 'test/result.test.mjs', caseDiscriminator(useCase, 0));
    const product = (value: number) => `// @concord-unknown-label invalid\nexport function result() { return ${value}; }\n`;
    writeFileSync(join(root, 'src/result.mjs'), product(1));
    assert.equal(call(['check'], Schema.Struct({ ok: Schema.Boolean }), 1).ok, false);
    assert.equal(call(['code', 'list'], error, 1).error, 'TraceInvalid');
    assert.equal(call(['test', 'list'], Schema.Struct({ cases: Schema.Array(Schema.Unknown) })).cases.length, 1);
    call(['test', 'show', resultCase], ack);
    const receipt = Schema.Struct({ commandOutcome: Schema.String });
    const red = call(['test', 'run', resultCase], receipt, 1); assert.equal(red.commandOutcome, 'fail');
    writeFileSync(join(root, 'src/result.mjs'), product(2));
    const green = call(['test', 'run', resultCase], receipt); assert.equal(green.commandOutcome, 'pass');
    const testFile = join(root, 'test/result.test.mjs');
    writeFileSync(testFile, readFileSync(testFile, 'utf8').replace(useCase, 'docs/feature/missing/README.md'));
    assert.equal(call(['test', 'list'], error, 1).error, 'TraceInvalid', 'original test reference validation remains enforced');
    writeProjectConfig(root, { ...config, sourceRoots: ['../escape'] });
    assert.equal(call(['doctor'], error, 1).error, 'UnsafePath');
    writeFileSync(join(root, 'concord.config.ts'), readFileSync(join(root, 'concord.config.ts'), 'utf8').replace(/"sourceRoots": \[[\s\S]*?\]/u, '"sourceRoots": "src"'));
    assert.equal(call(['doctor'], error, 1).error, 'InvalidData');

  } finally { rmSync(scratch, { recursive: true, force: true }); }
})));
