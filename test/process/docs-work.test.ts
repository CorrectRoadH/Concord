import { installedConcordCli } from '../support/support.js';
// @use-case docs/feature/neutral-project-governance/use-case/coordinate-docs-work.md
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from '../support/temporary.js';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { fixture, custom, waitingProcess } from '../support/docs-work-fixture.js';

const cli = process.env.CONCORD_DOCS_WORK_CLI ?? installedConcordCli();
interface Output { operation?: string; runId?: string; statePath?: string; error?: string; details?: { problems?: { code: string; path?: string }[] }; receiptDigest?: string; receipt?: { status: string; writeDigest: string; changedPaths: string[]; checks: { status: string; exitCode: number | null; summary: string }[] }; status?: string; blocked?: { itemId: string; reason: string }[] }
function call(root: string, args: readonly string[], status = 0, input?: string): Output {
  const result = spawnSync(process.execPath, [cli, '--root', root, '--json', 'docs', 'work', ...args], { cwd: root, encoding: 'utf8', timeout: 30000, input });
  assert.equal(result.status, status, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(status === 1 && result.stderr ? result.stderr : result.stdout) as Output;
}
function plan(root: string, items: unknown[], runId: string) {
  const path = join(tmpdir(), `docs-work-plan-${process.pid}-${runId}.json`);
  writeFileSync(path, JSON.stringify({ format: 'concord.docs-work-plan/v1', items }));
  try { return call(root, ['prepare', '--plan', path, '--run-id', runId]); } finally { rmSync(path); }
}
const item = (id: string, write: string[], rest: Record<string, unknown> = {}) => ({ id, goal: `Update ${id}`, write, checks: ['ok'], ...rest });
const report = (root: string, run: string, id: string) => call(root, ['check', run, id, '--report']);
const verify = (root: string, run: string, id: string, digest: string) => call(root, ['check', run, id, '--verify', digest]);

test('process argv is literal, timed-out groups are killed and argv budgets are named', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture({ checks: {
    literal: { argv: [process.execPath, '-e', 'console.log(process.argv[1])', '$(touch should-not-exist)'] },
    unicode: { argv: [process.execPath, '-e', 'console.log("文".repeat(3000))'] },
    timeout: { argv: [process.execPath, '-e', waitingProcess('child.pid')], timeoutMs: 5000 },
    long: { argv: [process.execPath, '-e', 'process.exit(0)', 'x'.repeat(128 * 1024)] },
  }, finalizer: { argv: [process.execPath, '-e', 'process.exit(2)'] } });
  try {
    plan(root, [item('literal', ['docs/a/'], { checks: ['literal'] }), item('timeout', ['docs/b/'], { checks: ['timeout'] }), item('long', ['docs/c/'], { checks: ['long'] }), item('unicode', ['docs/d/'], { checks: ['unicode'] })], 'process');
    const unicode = report(root, 'process', 'unicode'); assert.ok(Buffer.byteLength(unicode.receipt!.checks[0]!.summary) <= 4096);
    const literal = report(root, 'process', 'literal'); assert.match(literal.receipt!.checks[0]!.summary, /\$\(touch/); assert.equal(existsSync(join(root, 'should-not-exist')), false);
    const timed = call(root, ['check', 'process', 'timeout', '--report'], 1); assert.equal(timed.receipt!.checks[0]!.exitCode, null, timed.receipt!.checks[0]!.summary);
    assert.ok(existsSync(join(root, 'child.pid')), 'timed check must start and record its descendant before cleanup is asserted');
    const pid = readFileSync(join(root, 'child.pid'), 'utf8');
    if (process.platform === 'linux' && existsSync(`/proc/${pid}/stat`)) assert.match(readFileSync(`/proc/${pid}/stat`, 'utf8').slice(readFileSync(`/proc/${pid}/stat`, 'utf8').lastIndexOf(')') + 1), /^\s+[ZX]\s/u);
    else assert.throws(() => process.kill(Number(pid), 0));
    assert.equal(call(root, ['check', 'process', 'long', '--report'], 1).error, 'DocsWorkArgvTooLong');
    const finalRun = plan(root, [item('final', ['docs/a/'], { checks: ['literal'] })], 'failed-finalizer');
    const finalReport = report(root, 'failed-finalizer', 'final'); verify(root, 'failed-finalizer', 'final', finalReport.receiptDigest!);
    assert.equal(call(root, ['finalize', 'failed-finalizer'], 1).status, 'failed');
    assert.equal(call(root, ['finalize', 'failed-finalizer'], 1).status, 'failed');
    assert.ok(existsSync(join(finalRun.statePath!, 'finalize.json')));
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

test('stdin plans and trailing shared CLI flags work; verification re-runs checks and preserves failed output', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture({ checks: { once: { argv: [process.execPath, '-e', 'const fs=require("node:fs");const n=fs.existsSync("attempt")?1:0;fs.writeFileSync("attempt","x");console.log("attempt "+n);process.exit(n)'] } }, finalizer: custom.finalizer });
  try {
    const input = JSON.stringify({ format: 'concord.docs-work-plan/v1', items: [item('once', ['docs/a/'], { checks: ['once'] })] });
    const prepared = call(root, ['prepare', '--plan', '-', '--run-id', 'stdin'], 0, input);
    const reported = report(root, 'stdin', 'once');
    const failed = call(root, ['check', 'stdin', 'once', '--verify', reported.receiptDigest!], 1);
    assert.equal(failed.receipt!.status, 'reported'); assert.equal(failed.receipt!.checks[0]!.status, 'failed'); assert.match(failed.receipt!.checks[0]!.summary, /attempt 1/);
    assert.equal(existsSync(join(prepared.statePath!, 'receipts/once.verified.json')), false);
    const trailing = spawnSync(process.execPath, [cli, 'docs', 'work', 'show', 'stdin', '--root', root, '--json'], { cwd: tmpdir(), encoding: 'utf8', timeout: 30000 });
    assert.equal(trailing.status, 0, trailing.stderr); assert.equal(trailing.stdout.trim().split('\n').length, 1);
    assert.equal((JSON.parse(trailing.stdout) as Output).runId, 'stdin');
    assert.equal(call(root, ['prepare', '--plan', '-', '--run-id', 'malformed'], 1, '{broken').error, 'DocsWorkPlanInvalid');
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

test('cancelling public CLI reclaims the detached check group and releases the run lock', () => Effect.runPromise(Effect.gen(function*() {
  const root = yield* Effect.sync(() => fixture({ checks: { wait: { argv: [process.execPath, '-e', waitingProcess('cancel-child.pid', 'cancel-group.pid')] } }, finalizer: custom.finalizer }));
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const prepared = yield* Effect.sync(() => plan(root, [item('wait', ['docs/a/'], { checks: ['wait'] })], 'cancel'));
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

test('config set/show round-trip docsWork and reject malformed commands without changing the owner', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture(custom);
  const input = join(tmpdir(), `docs-work-config-${process.pid}.json`);
  try {
    const show = () => {
      const result = spawnSync(process.execPath, [cli, '--root', root, '--json', 'config', 'show'], { cwd: root, encoding: 'utf8', timeout: 30000 });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout) as { config: Record<string, unknown>; digest: string };
    };
    const current = show(); assert.deepEqual(current.config.docsWork, custom);
    const source = readFileSync(join(root, 'concord.config.ts'), 'utf8');
    for (const docsWork of [{ checks: { invalid: { argv: [] } } }, { finalizer: { argv: [process.execPath], timeoutMs: 0 } }, { unsupported: true }]) {
      writeFileSync(input, JSON.stringify({ ...current.config, docsWork }));
      const rejected = spawnSync(process.execPath, [cli, '--root', root, '--json', 'config', 'set', '--input', input, '--if-unchanged', current.digest], { cwd: root, encoding: 'utf8', timeout: 30000 });
      assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr); assert.equal((JSON.parse(rejected.stderr) as Output).error, 'InvalidData');
      assert.equal(readFileSync(join(root, 'concord.config.ts'), 'utf8'), source);
    }
    const configured = { ...custom, sharedPaths: ['docs/README.md'], finalizer: { ...custom.finalizer, timeoutMs: 2000 } };
    writeFileSync(input, JSON.stringify({ ...current.config, docsWork: configured }));
    const saved = spawnSync(process.execPath, [cli, '--root', root, '--json', 'config', 'set', '--input', input, '--if-unchanged', current.digest], { cwd: root, encoding: 'utf8', timeout: 30000 });
    assert.equal(saved.status, 0, saved.stderr); assert.deepEqual(show().config.docsWork, configured);
  } finally { rmSync(input, { force: true }); rmSync(root, { recursive: true, force: true }); }
})));
