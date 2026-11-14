// CLI preserves stdin plans and static receipts across invocations.
import { runCli } from '../support/cli.ts';
// @use-case docs/feature/neutral-project-governance/use-case/coordinate-docs-work.md
import assert from 'node:assert/strict';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { join } from 'node:path';
import test from 'node:test';
import { fixture } from '../support/docs-work-fixture.ts';

interface Output { operation?: string; runId?: string; statePath?: string; error?: string; details?: { problems?: { code: string; path?: string }[] }; receiptDigest?: string; receipt?: { status: string; writeDigest: string; changedPaths: string[]; checks: { status: string; exitCode: number | null; summary: string }[] }; status?: string; blocked?: { itemId: string; reason: string }[] }
function docsWorkCli(root: string, signal: AbortSignal) {
  const call = async (args: readonly string[], status = 0, input?: string): Promise<Output> => {
    const result = await runCli({ argv: ['--root', root, '--json', 'docs', 'work', ...args], cwd: root, env: process.env, stdin: input, signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
    assert.equal(result.exitCode, status, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
    return JSON.parse(status === 1 && result.stderr ? result.stderr : result.stdout) as Output;
  };
  const report = async (run: string, id: string) => call(['check', run, id, '--report']);
  const verify = async (run: string, id: string, digest: string) => call(['check', run, id, '--verify', digest]);
  return { call, report, verify };
}
const item = (id: string, write: string[]) => ({ id, goal: `Update ${id}`, write });

test('stdin plans and trailing shared CLI flags preserve static receipts across invocations', async t => {
  const root = fixture();
  const { call, report, verify } = docsWorkCli(root, t.signal);
  try {
    const input = JSON.stringify({ format: 'concord.docs-work-plan/v1', items: [item('writing', ['docs/a/'])] });
    const prepared = await call(['prepare', '--plan', '-', '--run-id', 'stdin'], 0, input);
    const reported = await report('stdin', 'writing');
    const verified = await verify('stdin', 'writing', reported.receiptDigest!);
    assert.equal(verified.receipt!.status, 'verified');
    assert.equal(verified.receipt!.checks[0]!.status, 'passed');
    assert.ok(existsSync(join(prepared.statePath!, 'receipts/writing.verified.json')));
    assert.deepEqual(JSON.parse(readFileSync(join(prepared.statePath!, 'receipts/writing.verified.json'), 'utf8')).checks, verified.receipt!.checks);
    const trailing = await runCli({ argv: ['docs', 'work', 'show', 'stdin', '--root', root, '--json'], cwd: tmpdir(), env: process.env, signal: AbortSignal.any([t.signal, AbortSignal.timeout(30000)]) });
    assert.equal(trailing.exitCode, 0, trailing.stderr); assert.equal(trailing.stdout.trim().split('\n').length, 1);
    assert.equal((JSON.parse(trailing.stdout) as Output).runId, 'stdin');
    assert.equal((await call(['prepare', '--plan', '-', '--run-id', 'malformed'], 1, '{broken')).error, 'DocsWorkPlanInvalid');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
