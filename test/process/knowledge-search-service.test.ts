// 跨进程保证：CLI RPC 与 HTTP 搜索共享服务持久库，clear 和退出排空数据库 Worker。
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Schema } from 'effect';
import { openHawdb } from '../../src/base/cache/index.ts';
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { command } from '../support/workspace-server-fixture.ts';
import { startViewServer, type ViewServerHandle } from '../support/view-server.ts';
import { send, jsonHeaders } from '../support/view-http-fixture.ts';

const Search = Schema.Struct({
  operation: Schema.String,
  documents: Schema.Array(Schema.Struct({ path: Schema.String, body: Schema.String })),
});
const decodeSearch = Schema.decodeUnknownSync(Schema.fromJsonString(Search), { onExcessProperty: 'ignore' });
const decodeHttp = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ ok: Schema.Literal(true), value: Search })), { onExcessProperty: 'ignore' });

// @use-case docs/feature/local-data-engine/use-case/query-current-projections.md#search
test('CLI and HTTP search persist current documents in the shared service database across clear', async () => {
  const root = await createConsumer();
  let server: ViewServerHandle | undefined;
  const closeServer = async () => {
    if (!server) return;
    // Keep the parent event loop available to reap its direct service child.
    const stopped = await command(root, ['server', 'stop']);
    try { await server.close(); } finally { server = undefined; }
    assert.equal(stopped.status, 0, stopped.stdout + stopped.stderr);
  };
  try {
    mkdirSync(join(root, 'memory'), { recursive: true });
    mkdirSync(join(root, 'docs/issues'), { recursive: true });
    writeFileSync(join(root, 'memory/current.md'), '# Current memory\n\nNeedle original.\n');
    writeFileSync(join(root, 'docs/issues/current.md'), '# Current issue\n\nNeedle issue.\n');
    server = await startViewServer({ root });
    const cliSearch = async (kind: 'memory' | 'issue', query: string) => {
      const result = await command(root, [kind, 'search', query]);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      return decodeSearch(result.stdout);
    };
    const httpSearch = async (kind: 'memory' | 'issue', query: string) => {
      const response = await send(server!, '/api/action', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ action: `${kind}.search`, query }) });
      assert.equal(response.status, 200, response.body);
      return decodeHttp(response.body).value;
    };
    assert.deepEqual((await cliSearch('memory', 'needle original')).documents.map(row => row.path), ['memory/current.md']);
    assert.deepEqual((await httpSearch('issue', 'needle issue')).documents.map(row => row.path), ['docs/issues/current.md']);
    writeFileSync(join(root, 'memory/current.md'), '# Current memory\n\nNeedle replacement.\n');
    assert.deepEqual((await httpSearch('memory', 'original')).documents, []);
    assert.match((await cliSearch('memory', 'replacement')).documents[0]!.body, /Needle replacement/u);
    const cleared = await send(server, '/api/action', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ action: 'cache.clear' }) });
    assert.equal(cleared.status, 200, cleared.body);
    assert.equal((await httpSearch('memory', 'replacement')).documents.length, 1);
    assert.equal((await cliSearch('issue', 'needle issue')).documents.length, 1);
    await closeServer();

    // Inspect the real persistent projection after the service releases ownership.
    const database = openHawdb(join(root, '.git/concord/cache.hawdb'), { create: false, readOnly: false }, makeRuntimeEnvironment(root, process.env));
    try {
      assert.deepEqual(database.query('MATCH (n:MemorySearchDocument) WHERE n.path = $path RETURN n.body AS body', { path: 'memory/current.md' }), [{ body: '# Current memory\n\nNeedle replacement.\n' }]);
      assert.deepEqual(database.query('MATCH (n:IssueSearchDocument) WHERE n.path = $path RETURN n.provider AS provider', { path: 'docs/issues/current.md' }), [{ provider: 'local' }]);
    } finally { database.close(); }
  } finally {
    try { await closeServer(); }
    finally { rmSync(root, { recursive: true, force: true }); }
  }
});
