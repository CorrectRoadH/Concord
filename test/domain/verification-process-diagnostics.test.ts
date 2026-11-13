import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { executeViewAction } from '../../src/app/index.ts';
import { ConcordError } from '../../src/model/index.ts';
import { humanOutput } from '../../src/entry/cli/index.ts';
import { createFixConsumer, gitCommit } from '../support/fix-consumer.ts';
import { runApplication } from '../support/repository.ts';
import { readProjectConfig, writeProjectConfig } from '../support/support.ts';

// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#close-fixed
test('verification adapter exchange failures expose bounded diagnostics and defect commit', async () => {
  const fixture = await createFixConsumer();
  try {
    writeFileSync(join(fixture.root, 'adapter.ts'), "process.stdout.write('discarded-prefix' + '界'.repeat(30000) + 'stdout-tail'); process.stderr.write('adapter dependency missing'); process.exit(23);\n");
    const config = await readProjectConfig(fixture.root);
    writeProjectConfig(fixture.root, { ...config, testAdapters: [{ id: 'external', include: ['test'], argv: [process.execPath, 'adapter.ts'], implementationFiles: ['adapter.ts'], inputRoots: [], frameworkVersion: 'fixture/v1', lockFiles: [], envNames: [] }] });
    const defect = gitCommit(fixture.root, 'adapter regression');
    const fix = fixture.fix();
    await assert.rejects(runApplication(executeViewAction(fixture.root, { action: 'issue.close', id: 'sku', fixed: true, defect, fix })), error => {
      assert.ok(error instanceof ConcordError);
      assert.equal(error.code, 'FixUnverifiable');
      const details = error.details as { process: Record<string, unknown> };
      assert.ok(details?.process, 'failed exchanges must expose process details');
      const process = details.process;
      assert.equal(process.commit, `defect ${defect}`);
      assert.equal(process.step, 'adapter exchange');
      assert.equal(process.op, 'collect-plan');
      assert.equal(process.cwd, '.');
      assert.equal(process.exitCode, 23);
      assert.equal(process.signal, null); assert.equal(process.timedOut, false);
      assert.deepEqual(process.argv, [globalThis.process.execPath, 'adapter.ts']);
      assert.equal(process.stderr, 'adapter dependency missing');
      assert.equal(process.stdoutTruncated, true);
      assert.ok(Buffer.byteLength(String(process.stdout)) <= 64 * 1024);
      assert.ok(String(process.stdout).endsWith('stdout-tail'));
      assert.ok(!String(process.stdout).includes('discarded-prefix'));
      assert.ok(!String(process.stdout).includes('\uFFFD'));
      const text = humanOutput({ ok: false, error: error.code, message: error.message, details });
      assert.match(text, /process:\n/); assert.match(text, /adapter dependency missing/); assert.match(text, /collect-plan/); assert.match(text, new RegExp(defect));
      return true;
    });
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#close-fixed
test('verification failed fix runner retains command output and fix commit', async () => {
  const fixture = await createFixConsumer();
  try {
    const config = await readProjectConfig(fixture.root);
    writeProjectConfig(fixture.root, { ...config, runner: { argv: [process.execPath, '-e', "console.error('runner-tail');process.exit(7)"], timeoutMs: 5000 } });
    const defect = gitCommit(fixture.root, 'runner regression'); const fix = fixture.fix();
    await assert.rejects(runApplication(executeViewAction(fixture.root, { action: 'issue.close', id: 'sku', fixed: true, defect, fix })), error => {
      assert.ok(error instanceof ConcordError); assert.equal(error.code, 'FixVerificationFailed');
      const details = error.details as { process: Record<string, unknown> };
      assert.ok(details?.process, 'failed runners must expose process details');
      assert.equal(details.process.commit, `fix ${fix}`); assert.equal(details.process.step, 'runner command');
      assert.equal(details.process.exitCode, 7); assert.equal(details.process.cwd, '.');
      assert.match(String(details.process.stderr), /runner-tail/);
      return true;
    });
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});
