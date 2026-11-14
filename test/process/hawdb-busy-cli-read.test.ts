// 跨进程保证：原生模块与句柄——另一进程的数据库句柄占用使当前来源CLI读取具名失败。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { cacheDatabasePath, openHawdb } from '../../src/base/cache/index.ts';
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { ensureGenericPrivateDirectorySync, genericPrivateDirectorySync } from '../../src/base/publication/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { sourceCli } from '../support/source-consumer.ts';
import { stopWorkspaceServer } from '../support/stop-workspace-server.ts';
import { Schema } from 'effect';


// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md#hit
test('a CLI current-source check fails fast while another process holds the persistent database', async () => {
  const root = (await createConsumer());
  const runtime = makeRuntimeEnvironment(root, process.env);
  const call = (...argv: string[]) => spawnSync(process.execPath, [sourceCli(), '--root', root, '--json', ...argv], { encoding: 'utf8', timeout: 30_000 });
  try {
    const reference = call('--dry-run', 'check');
    assert.equal(reference.status, 0, reference.stdout + reference.stderr);
    assert.equal(existsSync(join(root, '.git/concord/server/current.json')), false);
    const privateDir = genericPrivateDirectorySync(root, runtime.env);
    ensureGenericPrivateDirectorySync(root, privateDir, runtime.env);
    const held = openHawdb(cacheDatabasePath(privateDir), { readOnly: false, create: true }, runtime);
    try {
      const result = call('check');
      assert.equal(result.status, 1, result.stdout + result.stderr);
      const report = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ error: Schema.String })), { onExcessProperty: 'ignore' })(result.stderr);
      assert.equal(report.error, 'HawdbBusy');
      assert.equal(result.stdout, '');
    } finally { stopWorkspaceServer(root); held.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
