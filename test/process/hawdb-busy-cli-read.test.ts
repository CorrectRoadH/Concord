// 跨进程保证：原生模块与句柄——无服务时另一进程的数据库句柄占用不阻断当前来源CLI读取。
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

const Report = Schema.Struct({ ok: Schema.Boolean, findings: Schema.Array(Schema.Json), cache: Schema.Struct({ status: Schema.String, detail: Schema.optionalKey(Schema.String) }) });

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md#hit
test('a CLI current-source check falls back while another process holds the persistent database', async () => {
  const root = (await createConsumer());
  const runtime = makeRuntimeEnvironment(root, process.env);
  const call = (...argv: string[]) => spawnSync(process.execPath, [sourceCli(), '--root', root, '--json', ...argv], { encoding: 'utf8', timeout: 30_000 });
  try {
    const reference = call('--dry-run', 'check');
    const expected = Schema.decodeUnknownSync(Schema.fromJsonString(Report), { onExcessProperty: 'ignore' })(reference.stdout);
    assert.equal(existsSync(join(root, '.git/concord/server/current.json')), false);
    const privateDir = genericPrivateDirectorySync(root, runtime.env);
    ensureGenericPrivateDirectorySync(root, privateDir, runtime.env);
    const held = openHawdb(cacheDatabasePath(privateDir), { readOnly: false, create: true }, runtime);
    try {
      const result = call('check');
      assert.equal(result.status, reference.status, result.stdout + result.stderr);
      const report = Schema.decodeUnknownSync(Schema.fromJsonString(Report), { onExcessProperty: 'ignore' })(result.stdout);
      assert.equal(report.ok, expected.ok);
      assert.deepEqual(report.findings, expected.findings);
      assert.equal(report.cache.status, 'unavailable');
      assert.equal(report.cache.detail, 'HawdbBusy: Persistent cache is owned by another command');
      assert.equal(result.stderr, '');
    } finally { stopWorkspaceServer(root); held.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
