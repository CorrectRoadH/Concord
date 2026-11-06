// 跨进程保证：进程终止与信号——真实检查进程组超时或CLI取消后子孙退出并释放run锁，失败finalizer不被重跑。
import { installedConcordCli } from '../support/support.ts';
import { runCli } from '../support/cli.ts';
// @use-case docs/feature/neutral-project-governance/use-case/coordinate-docs-work.md
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { fixture, custom, waitingProcess } from '../support/docs-work-fixture.ts';

const cli = process.env.CONCORD_DOCS_WORK_CLI ?? installedConcordCli();
interface Output { operation?: string; runId?: string; statePath?: string; error?: string; details?: { problems?: { code: string; path?: string }[] }; receiptDigest?: string; receipt?: { status: string; writeDigest: string; changedPaths: string[]; checks: { status: string; exitCode: number | null; summary: string }[] }; status?: string; blocked?: { itemId: string; reason: string }[] }
function docsWorkCli(root: string, signal: AbortSignal) {
  const call = async (args: readonly string[], status = 0, input?: string): Promise<Output> => {
    const result = await runCli({ argv: ['--root', root, '--json', 'docs', 'work', ...args], cwd: root, env: process.env, stdin: input, signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
    assert.equal(result.exitCode, status, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
    return JSON.parse(status === 1 && result.stderr ? result.stderr : result.stdout) as Output;
  };
  const plan = async (items: unknown[], runId: string) => {
    const path = join(tmpdir(), `docs-work-plan-${process.pid}-${runId}.json`);
    writeFileSync(path, JSON.stringify({ format: 'concord.docs-work-plan/v1', items }));
    try { return await call(['prepare', '--plan', path, '--run-id', runId]); } finally { rmSync(path); }
  };
  const report = (run: string, id: string) => call(['check', run, id, '--report']);
  const verify = (run: string, id: string, digest: string) => call(['check', run, id, '--verify', digest]);
  return { call, plan, report, verify };
}
const item = (id: string, write: string[], rest: Record<string, unknown> = {}) => ({ id, goal: `Update ${id}`, write, checks: ['ok'], ...rest });

test('process argv is literal, timed-out groups are killed and argv budgets are named', async t => {
  const root = fixture({ checks: {
    literal: { argv: [process.execPath, '-e', 'console.log(process.argv[1])', '$(touch should-not-exist)'] },
    unicode: { argv: [process.execPath, '-e', 'console.log("文".repeat(3000))'] },
    timeout: { argv: [process.execPath, '-e', waitingProcess('child.pid')], timeoutMs: 5000 },
    long: { argv: [process.execPath, '-e', 'process.exit(0)', 'x'.repeat(128 * 1024)] },
  }, finalizer: { argv: [process.execPath, '-e', 'process.exit(2)'] } });
  const { call, plan, report, verify } = docsWorkCli(root, t.signal);
  try {
    await plan([item('literal', ['docs/a/'], { checks: ['literal'] }), item('timeout', ['docs/b/'], { checks: ['timeout'] }), item('long', ['docs/c/'], { checks: ['long'] }), item('unicode', ['docs/d/'], { checks: ['unicode'] })], 'process');
    const unicode = await report('process', 'unicode'); assert.ok(Buffer.byteLength(unicode.receipt!.checks[0]!.summary) <= 4096);
    const literal = await report('process', 'literal'); assert.match(literal.receipt!.checks[0]!.summary, /\$\(touch/); assert.equal(existsSync(join(root, 'should-not-exist')), false);
    const timed = await call(['check', 'process', 'timeout', '--report'], 1); assert.equal(timed.receipt!.checks[0]!.exitCode, null, timed.receipt!.checks[0]!.summary);
    assert.ok(existsSync(join(root, 'child.pid')), 'timed check must start and record its descendant before cleanup is asserted');
    const pid = readFileSync(join(root, 'child.pid'), 'utf8');
    if (process.platform === 'linux' && existsSync(`/proc/${pid}/stat`)) assert.match(readFileSync(`/proc/${pid}/stat`, 'utf8').slice(readFileSync(`/proc/${pid}/stat`, 'utf8').lastIndexOf(')') + 1), /^\s+[ZX]\s/u);
    else assert.throws(() => process.kill(Number(pid), 0));
    assert.equal((await call(['check', 'process', 'long', '--report'], 1)).error, 'DocsWorkArgvTooLong');
    const finalRun = await plan([item('final', ['docs/a/'], { checks: ['literal'] })], 'failed-finalizer');
    const finalReport = await report('failed-finalizer', 'final'); await verify('failed-finalizer', 'final', finalReport.receiptDigest!);
    assert.equal((await call(['finalize', 'failed-finalizer'], 1)).status, 'failed');
    assert.equal((await call(['finalize', 'failed-finalizer'], 1)).status, 'failed');
    assert.ok(existsSync(join(finalRun.statePath!, 'finalize.json')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('stdin plans and trailing shared CLI flags work; verification re-runs checks and preserves failed output', async t => {
  const root = fixture({ checks: { once: { argv: [process.execPath, '-e', 'const fs=require("node:fs");const n=fs.existsSync("attempt")?1:0;fs.writeFileSync("attempt","x");console.log("attempt "+n);process.exit(n)'] } }, finalizer: custom.finalizer });
  const { call, report } = docsWorkCli(root, t.signal);
  try {
    const input = JSON.stringify({ format: 'concord.docs-work-plan/v1', items: [item('once', ['docs/a/'], { checks: ['once'] })] });
    const prepared = await call(['prepare', '--plan', '-', '--run-id', 'stdin'], 0, input);
    const reported = await report('stdin', 'once');
    const failed = await call(['check', 'stdin', 'once', '--verify', reported.receiptDigest!], 1);
    assert.equal(failed.receipt!.status, 'reported'); assert.equal(failed.receipt!.checks[0]!.status, 'failed'); assert.match(failed.receipt!.checks[0]!.summary, /attempt 1/);
    assert.equal(existsSync(join(prepared.statePath!, 'receipts/once.verified.json')), false);
    const trailing = await runCli({ argv: ['docs', 'work', 'show', 'stdin', '--root', root, '--json'], cwd: tmpdir(), env: process.env, signal: AbortSignal.any([t.signal, AbortSignal.timeout(30000)]) });
    assert.equal(trailing.exitCode, 0, trailing.stderr); assert.equal(trailing.stdout.trim().split('\n').length, 1);
    assert.equal((JSON.parse(trailing.stdout) as Output).runId, 'stdin');
    assert.equal((await call(['prepare', '--plan', '-', '--run-id', 'malformed'], 1, '{broken')).error, 'DocsWorkPlanInvalid');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('cancelling public CLI reclaims the detached check group and releases the run lock', t => Effect.runPromise(Effect.gen(function*() {
  const root = yield* Effect.sync(() => fixture({ checks: { wait: { argv: [process.execPath, '-e', waitingProcess('cancel-child.pid', 'cancel-group.pid')] } }, finalizer: custom.finalizer }));
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const prepared = yield* Effect.promise(() => docsWorkCli(root, t.signal).plan([item('wait', ['docs/a/'], { checks: ['wait'] })], 'cancel'));
    child = yield* Effect.sync(() => spawn(process.execPath, [cli, '--root', root, '--json', 'docs', 'work', 'check', 'cancel', 'wait', '--report'], { cwd: root, stdio: 'ignore' }));
    for (let attempt = 0; attempt < 200 && !existsSync(join(root, 'cancel-child.pid')); attempt++) yield* Effect.sleep(25);
    assert.ok(existsSync(join(root, 'cancel-child.pid')), 'check child must start before cancellation');
    const running = child;
    yield* Effect.callback<void>(resume => {
      const onClose = () => resume(Effect.void);
      running.once('close', onClose);
      running.kill('SIGINT');
      return Effect.sync(() => running.off('close', onClose));
    }).pipe(Effect.timeout(10000));
    yield* Effect.sync(() => {
      assert.equal(existsSync(join(prepared.statePath!, 'lock')), false);
      assert.equal(existsSync(join(prepared.statePath!, 'receipts/wait.reported.json')), false);
      const pid = readFileSync(join(root, 'cancel-child.pid'), 'utf8');
      if (process.platform === 'linux' && existsSync(`/proc/${pid}/stat`)) {
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf8'); assert.match(stat.slice(stat.lastIndexOf(')') + 1), /^\s+[ZX]\s/u);
      } else assert.throws(() => process.kill(Number(pid), 0));
    });
  } finally {
    yield* Effect.sync(() => {
      if (child?.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      if (existsSync(join(root, 'cancel-group.pid'))) { try { process.kill(-Number(readFileSync(join(root, 'cancel-group.pid'), 'utf8')), 'SIGKILL'); } catch { /* already reaped */ } }
      rmSync(root, { recursive: true, force: true });
    });
  }
})));
