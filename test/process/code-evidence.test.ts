// 跨进程保证：外部程序——真实Node runner在代码标记错误时仍执行测试并保留红绿退出结果。
import { existsSync } from 'node:fs';
import { createDocument } from '../support/operations.ts';
import { createConsumer } from '../support/consumer.ts';
import { LocalRepository } from '../support/repository.ts';
import type { DocumentKind } from '../../src/model/index.ts';
import type { CreateDocumentInput } from '../../src/app/index.ts';
import { sourceCli } from '../support/source-consumer.ts';
import { runCli } from '../support/cli.ts';
import { stopWorkspaceServer } from '../support/stop-workspace-server.ts';
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
test('code findings preserve real red and green test execution and original reference validation', () => Effect.runPromise(Effect.promise(async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'concord-code-cli-'));
  let root: string | undefined;
  try {

    assert.ok(existsSync(sourceCli()));
    root = (await createConsumer());
    const consumer = root;
    writeProjectConfig(root, { sourceRoots: ['src', 'test'], testRoots: [] });
    const repo = (await LocalRepository.open(root));
    try {
      (await createDocument(repo, 'feature', { id: 'orders', title: 'Orders' }));
      (await createDocument(repo, 'use-case', { id: 'create-order', title: 'Create order', feature: 'orders' }));
    } finally { repo.close(); }
    mkdirSync(join(root, 'src')); mkdirSync(join(root, 'test'));
    const useCase = 'docs/feature/orders/use-case/create-order.md';
    const config = (await readProjectConfig(root)), ack = Schema.Struct({}), error = Schema.Struct({ error: Schema.String });
    async function call<A>(args: readonly string[], schema: Schema.ConstraintDecoder<A, never>, status = 0): Promise<A> {
      const result = await runCli({ argv: ['--root', consumer, '--json', '--fresh', ...args], cwd: process.cwd(), env: process.env, signal: AbortSignal.timeout(30000) });
      assert.equal(result.exitCode, status, JSON.stringify({ args, ...result }));
      return Schema.decodeUnknownSync(Schema.fromJsonString(schema))(result.stdout.trim() || result.stderr.trim());
    }
    // A code finding must not become an extra precondition for real red/green evidence.
    await call(['new', 'issue', 'wrong-result', '--title', 'Wrong result'], ack);
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
    assert.equal((await call(['check'], Schema.Struct({ ok: Schema.Boolean }), 1)).ok, false);
    assert.equal((await call(['code', 'list'], error, 1)).error, 'TraceInvalid');
    assert.equal((await call(['test', 'list'], Schema.Struct({ cases: Schema.Array(Schema.Unknown) }))).cases.length, 1);
    await call(['test', 'show', resultCase], ack);
    const receipt = Schema.Struct({ commandOutcome: Schema.String });
    const red = await call(['test', 'run', resultCase], receipt, 1); assert.equal(red.commandOutcome, 'fail');
    writeFileSync(join(root, 'src/result.mjs'), product(2));
    const green = await call(['test', 'run', resultCase], receipt); assert.equal(green.commandOutcome, 'pass');
    const testFile = join(root, 'test/result.test.mjs');
    writeFileSync(testFile, readFileSync(testFile, 'utf8').replace(useCase, 'docs/feature/missing/README.md'));
    assert.equal((await call(['test', 'list'], error, 1)).error, 'TraceInvalid', 'original test reference validation remains enforced');
    writeProjectConfig(root, { ...config, sourceRoots: ['../escape'] });
    assert.equal((await call(['doctor'], error, 1)).error, 'UnsafePath');
    writeFileSync(join(root, 'concord.config.ts'), readFileSync(join(root, 'concord.config.ts'), 'utf8').replace(/"sourceRoots": \[[\s\S]*?\]/u, '"sourceRoots": "src"'));
    assert.equal((await call(['doctor'], error, 1)).error, 'InvalidData');

  } finally {
    if (root !== undefined) { stopWorkspaceServer(root); rmSync(root, { recursive: true, force: true }); }
    rmSync(scratch, { recursive: true, force: true });
  }
})));
