import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import test from 'node:test';
import { createConsumer } from '../support/consumer.ts';
import { createDocument } from '../support/operations.ts';
import { withRepository } from '../support/application-fixture.ts';
import { runCli } from '../support/cli.ts';
import { linkIssue } from '../../src/domain/issues/index.ts';

async function call(root: string, args: readonly string[], status = 0): Promise<Record<string, unknown>> {
  const result = await runCli({ argv: ['--root', root, '--json', ...args], cwd: root, env: process.env, signal: AbortSignal.timeout(30_000) });
  assert.equal(result.exitCode, status, JSON.stringify({ args, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }));
  return JSON.parse(result.stdout.trim() || result.stderr) as Record<string, unknown>;
}

// @use-case docs/engineering/testing/use-case/write-behavior-test.md#write
test('issue close refuses with a named error and exit 1', async t => {
  for (const [row, linked, expected] of [
    ['another Issue links it', true, 'IssueReferenced'],
    ['the Issue does not exist', false, 'DocumentNotFound'],
  ] as const) await t.test(row, async () => {
    const root = createConsumer();
    try {
      if (linked) withRepository(root, repo => {
        for (const id of ['one', 'two']) createDocument(repo, 'issue', { id, title: id });
        linkIssue(repo, 'two', 'docs/issues/one.md', false, 'related');
      });
      assert.equal((await call(root, ['issue', 'close', 'one', '--reason', 'Done'], 1)).error, expected);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
