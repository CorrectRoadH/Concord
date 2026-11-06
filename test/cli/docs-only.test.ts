import { sourceCli } from '../support/source-consumer.ts';
import { runCli } from '../support/cli.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { join } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';

import { readProjectConfig, writeProjectConfig } from '../support/support.ts';

// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
test('packed CLI manages documentation without test roots and can later discover real tests', () => Effect.runPromise(Effect.promise(async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'concord-docs-only-'));
  try {

    assert.ok(existsSync(sourceCli()));
    const cli = sourceCli();
    const root = join(scratch, 'consumer');
    mkdirSync(root);
    execFileSync('git', ['init', '-q', root]);
    async function call<A>(args: readonly string[], schema: Schema.ConstraintDecoder<A, never>, status = 0): Promise<A> {
      const result = await runCli({argv:['--root',root,'--json','--fresh',...args],cwd:process.cwd(),env:process.env,signal:AbortSignal.timeout(20000)});
      assert.equal(result.exitCode, status, JSON.stringify({ args, status: result.exitCode, stdout: result.stdout, stderr: result.stderr }));
      const output = result.stdout || result.stderr;
      try { return Schema.decodeUnknownSync(Schema.fromJsonString(schema))(output); }
      catch (cause) { throw new Error(`Could not decode ${args.join(' ')} output ${JSON.stringify(output)}`, { cause }); }
    }
    const ack = Schema.Struct({});
    const diagnosis = Schema.Struct({ cases: Schema.Int, missingTestRoots: Schema.Array(Schema.String), nextSteps: Schema.Array(Schema.String) });
    assert.equal((await call(['init', '--docs-only', '--test-root', 'test'], Schema.Struct({ error: Schema.String }), 1)).error, 'ConflictingOptions');
    assert.equal(existsSync(join(root, 'concord.config.ts')), false);
    (await call(['--dry-run', 'init', '--docs-only'], ack));
    assert.equal(existsSync(join(root, 'concord.config.ts')), false);
    (await call(['init', '--docs-only'], ack));
    const config = readProjectConfig(root);
    assert.deepEqual(config.testRoots, []);
    (await call(['new', 'feature', 'backup', '--title', 'Backup'], ack));
    (await call(['new', 'design', 'storage', '--title', 'Storage'], ack));
    assert.equal(existsSync(join(root, 'docs/design/storage.md')), true);
    const initial = (await call(['doctor'], diagnosis));
    assert.equal(initial.cases, 0);
    assert.deepEqual(initial.missingTestRoots, []);
    assert.ok(initial.nextSteps.some(step => step.includes('--skill document')));
    assert.equal((await call(['check'], Schema.Struct({ ok: Schema.Boolean }))).ok, true);
    assert.deepEqual((await call(['trace', 'show', 'backup'], Schema.Struct({ tests: Schema.Array(Schema.Unknown) }))).tests, []);
    assert.equal(existsSync(join(root, 'test')), false);
    mkdirSync(join(root, 'test'));
    writeFileSync(join(root, 'test/backup.test.mjs'), "import test from 'node:test';\n// @feature docs/feature/backup/README.md\ntest('backup', () => {});\n");
    assert.equal((await call(['doctor'], diagnosis)).cases, 0, 'empty roots disable discovery even when test files exist');
    writeProjectConfig(root, { ...config, testRoots: ['test'] });
    assert.equal((await call(['doctor'], diagnosis)).cases, 1);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
})));
