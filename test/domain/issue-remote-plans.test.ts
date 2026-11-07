import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import type { feedback_schema_FeedbackConnection as FeedbackConnection, IssuePayload } from '../../src/model/index.ts';
import { remoteIssueConnection, remoteIssueConsumer } from '../support/issue-remote-domain.ts';

// @use-case docs/feature/neutral-project-governance/use-case/mutate-remote-issue.md
test('remote previews reject invalid labels and unsupported connections before any external process or receipt', async t => {
  const { repositoryId: _repositoryId, ...unbound } = remoteIssueConnection;
  const rows: readonly { readonly row: string; readonly connection: FeedbackConnection; readonly payload: IssuePayload; readonly code: string }[] = [
    { row: 'C6 label exceeds 50 characters', connection: remoteIssueConnection, payload: { operation: 'labels-add', labels: ['x'.repeat(51)] }, code: 'IssueInputError' },
    { row: 'C7 label contains a newline', connection: remoteIssueConnection, payload: { operation: 'labels-add', labels: ['bad\nlabel'] }, code: 'IssueInputError' },
    { row: 'C8 labels-remove receives two labels', connection: remoteIssueConnection, payload: { operation: 'labels-remove', labels: ['old', 'other'] }, code: 'IssueInputError' },
    { row: 'C12 gh connection has no repository binding', connection: unbound, payload: { operation: 'close' }, code: 'IssueConnectionUnbound' },
    { row: 'C13 API transport cannot plan remote writes', connection: { ...remoteIssueConnection, transport: 'api', credentialEnv: 'TEST_TOKEN' }, payload: { operation: 'close' }, code: 'IssueRemoteTransportUnsupported' },
  ];
  for (const row of rows) await t.test(row.row, async () => {
    const fixture = (await remoteIssueConsumer(row.connection));
    try {
      await assert.rejects(fixture.preview(row.payload), { _tag: row.code });
      assert.equal(fixture.calls(), '', `${row.row}: no gh request`);
      assert.deepEqual(await fixture.processes(), [], `${row.row}: no external process`);
      assert.equal(existsSync(join(fixture.root, '.git/concord/issue-plan/v1/planned')), false, `${row.row}: failed plan must not sign a receipt`);
    } finally { await fixture.close(); }
  });
});
