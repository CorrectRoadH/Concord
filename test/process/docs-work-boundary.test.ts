// 跨进程保证：外部程序——DocsWork 的真实 custom 检查与 finalizer 完成后，重复 finalize 保留具名失败与退出码。
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Schema } from 'effect';
import { runCli } from '../support/cli.ts';
import { fixture, custom } from '../support/docs-work-fixture.ts';
import { plan, report, verify, finalize, item } from '../support/docs-work-domain-fixture.ts';

// @use-case docs/feature/neutral-project-governance/use-case/coordinate-docs-work.md
test('docs work preserves finalized rejection after the real custom check and finalizer complete', async () => {
  const root = fixture(custom);
  try {
    await plan(root, [item('done', ['docs/c/'])], 'final');
    const receipt = await report(root, 'final', 'done');
    await verify(root, 'final', 'done', receipt.receiptDigest!); await finalize(root, 'final');
    const checks = readFileSync(join(root, 'check-count'), 'utf8');
    assert.equal(checks, '2', 'report and verify each await the real custom command');
    assert.equal(readFileSync(join(root, 'finalizer-count'), 'utf8'), '1');
    const result = await runCli({ argv: ['--root', root, '--json', 'docs', 'work', 'finalize', 'final'], cwd: process.cwd(), env: process.env, signal: AbortSignal.timeout(30_000) });
    assert.equal(result.exitCode, 1, result.stdout + result.stderr);
    assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ error: Schema.String })))(result.stderr).error, 'DocsWorkFinalized');
    assert.equal(readFileSync(join(root, 'check-count'), 'utf8'), checks);
    assert.equal(readFileSync(join(root, 'finalizer-count'), 'utf8'), '1', 'the rejected duplicate cannot rerun the external finalizer');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
