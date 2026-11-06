import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import test from 'node:test';
import { createConsumer } from '../support/consumer.ts';
import { createDocument } from '../support/operations.ts';
import { withRepository } from '../support/application-fixture.ts';
import { sourceCli } from '../support/source-consumer.ts';
import { linkIssue } from '../../src/domain/issues/index.ts';

function call(root: string, args: readonly string[], status = 0): Record<string, unknown> {
  const result = spawnSync(process.execPath, [sourceCli(), '--root', root, '--json', ...args], { cwd: root, encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, status, JSON.stringify({ args, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr }));
  return JSON.parse(result.stdout.trim() || result.stderr) as Record<string, unknown>;
}

// @use-case docs/engineering/testing/use-case/write-behavior-test.md#write
test('issue close refuses with a named error and exit 1', async t => {
  for (const [row, linked, expected] of [
    ['another Issue links it', true, 'IssueReferenced'],
    ['the Issue does not exist', false, 'DocumentNotFound'],
  ] as const) await t.test(row, () => {
    const root = createConsumer();
    try {
      if (linked) withRepository(root, repo => {
        for (const id of ['one', 'two']) createDocument(repo, 'issue', { id, title: id });
        linkIssue(repo, 'two', 'docs/issues/one.md', false, 'related');
      });
      assert.equal(call(root, ['issue', 'close', 'one', '--reason', 'Done'], 1).error, expected);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
