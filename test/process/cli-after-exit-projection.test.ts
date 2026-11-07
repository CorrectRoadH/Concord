// 跨进程保证：服务与 IPC——真实CLI退出后后台投影发布并使后续CLI读到historical回执
import { assert, spawnSync, test, Schema, pollUntil, Ack, ErrorOutput, cli, call, consumer } from '../support/cli-fixture.ts';


// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
test('packed diagnostic CLI refreshes after exit and marks cached output as historical', async () => {
 const root = consumer('async-query');
 (await call(root, ['new', 'feature', 'cached', '--title', 'Cached'], Ack));
 const query = () => spawnSync(process.execPath, [cli, '--root', root, '--json', 'trace', 'gaps'], { encoding: 'utf8', timeout: 20000 });
 const first = query();
 assert.equal(first.status, 0, first.stdout + first.stderr);
 assert.equal(JSON.parse(first.stdout).projection.current, false);
 const result = await pollUntil(async () => {
  const result = query();
  if (result.status === 0) return result;
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const error = Schema.decodeUnknownSync(Schema.fromJsonString(ErrorOutput), { onExcessProperty: 'ignore' })(result.stderr);
  assert.ok(['QueryPending', 'HawdbBusy'].includes(error.error), result.stderr);
  return undefined;
 }, { timeoutMs: 30000, description: 'packed diagnostic projection' });
 assert.equal(result.status, 0, result.stdout + result.stderr);
 const value = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ projection: Schema.Struct({ current: Schema.Literal(false), builtAt: Schema.String, refresh: Schema.String }) })))(result.stdout);
 assert.equal(value.projection.refresh, 'requested');
 assert.ok(Number.isFinite(Date.parse(value.projection.builtAt)));
});
