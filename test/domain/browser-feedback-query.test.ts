import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Schema } from 'effect';
import { executeViewAction } from '../../src/app/index.ts';
import { cacheDatabasePath, mergeFeedbackCache, openHawdb } from '../../src/base/cache/index.ts';
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { startHostedViewServer } from '../../src/entry/http/index.ts';
import { loadDocuments } from '../../src/domain/documents/index.ts';
import { renderDocument, type FeedbackSource } from '../../src/model/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { createDocument } from '../support/operations.ts';
import { LocalRepository, runApplication } from '../support/repository.ts';
import { fetchFresh } from '../support/support.ts';

const FeedbackList = Schema.Struct({
  operation: Schema.Literal('feedback-list'),
  feedback: Schema.Array(Schema.Struct({ document: Schema.Struct({ metadata: Schema.Struct({ id: Schema.String }) }) })),
});

// @use-case docs/feature/feedback/use-case/triage-feedback.md#browse
test('feedback action filters the original source while a newer cached remote observation stays separate', async () => {
  const root = (await createConsumer());
  const path = join(root, 'docs/issues/remote-observation.md');
  try {
    const repo = (await LocalRepository.open(root));
    try {
      openHawdb(cacheDatabasePath(repo.privateDir), { readOnly: false, create: true }, makeRuntimeEnvironment(process.cwd(), process.env)).close();
      (await createDocument(repo, 'feature', { id: 'target', title: 'Feedback target' }));
      (await createDocument(repo, 'issue', { id: 'remote-observation', title: 'Local title retained', body: 'Local notes retained.' }));
      (await createDocument(repo, 'issue', { id: 'local-unrelated', title: 'Unrelated local feedback' }));
      const document = loadDocuments(repo).find(item => item.metadata.id === 'remote-observation');
      assert.ok(document?.metadata.kind === 'issue');
      const source: FeedbackSource = { provider: 'github', instance: 'https://api.github.com', id: '123', url: 'https://github.com/example/demo/issues/7', title: 'Original remote title', body: 'Original remote body', state: 'open', updatedAt: '2026-09-13T00:00:00.000Z', connectionId: 'fixture', importedAt: '2026-09-13T01:00:00.000Z' };
      writeFileSync(path, renderDocument({ ...document.metadata, source }, document.body));
      const { connectionId: _connectionId, importedAt: _importedAt, ...remote } = source;
      mergeFeedbackCache(repo, 'fixture', [{ ...remote, title: 'Updated remote title', body: 'Updated remote body', state: 'closed', updatedAt: '2026-09-14T00:00:00.000Z' }]);
    } finally { repo.close(); }
    const before = readFileSync(path);
    // Exercise the real HTTP adapter and application together; unrelated ports
    // fail if called, and no browser, workspace daemon or frontend is started.
    const unused = (): never => { throw new Error('Unexpected non-action HTTP port'); };
    const server = await startHostedViewServer({ root, port: 0, webRoot: root }, {
      verify: async () => {}, workspace: unused, refresh: unused, read: unused, git: unused, diff: unused, compile: unused,
      action: input => runApplication(executeViewAction(root, input)),
      subscribe: unused, sse: unused,
    }, makeRuntimeEnvironment(process.cwd(), process.env), () => true);
    try {
      const post = (input: unknown) => fetchFresh(new URL('/api/action', server.address), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
      });
      const response = await post({ action: 'feedback.list', provider: 'github', triage: 'pending', query: 'original remote' });
      assert.equal(response.status, 200);
      const result = Schema.decodeUnknownSync(Schema.Struct({ ok: Schema.Literal(true), value: FeedbackList }), { onExcessProperty: 'ignore' })(await response.json());
      assert.deepEqual(result.value.feedback.map(item => item.document.metadata.id), ['remote-observation']);
      const invalid = await post({ action: 'issue.list', state: 'draft' });
      assert.equal(invalid.status, 400);
      await invalid.body?.cancel();
    } finally { await server.close(); }
    assert.deepEqual(readFileSync(path), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
