// 跨进程保证：服务与 IPC——cache status报告真实CLI或工作区服务PID与安装身份，不混淆两个owner。
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import assert from 'node:assert/strict';
import { rmSync, existsSync } from 'node:fs';
import test from 'node:test';
import { Schema } from 'effect';
import { fixture, command, record, recordPath, stop } from '../support/workspace-server-fixture.ts';
import { serverInstallation } from '../../src/base/server-lock/index.ts';
import { pollUntil } from '../support/support.ts';

const nativeRuntime = makeRuntimeEnvironment(process.cwd(), process.env);

const Status = Schema.Struct({ owner: Schema.Literals(['service', 'process']), pid: Schema.Int, installation: Schema.String, sourceDigest: Schema.optional(Schema.String) });
const decode = Schema.decodeUnknownSync(Schema.fromJsonString(Status));

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md#status
test('cache status identifies the actual CLI or workspace service owner', async () => {
  const root = (await fixture());
  try {
    const local = await command(root, ['cache', 'status']);
    assert.equal(local.status, 0, local.stderr);
    const processStatus = decode(local.stdout);
    assert.equal(processStatus.owner, 'process');
    assert.ok(processStatus.pid > 0);
    assert.notEqual(processStatus.pid, process.pid);
    assert.equal(processStatus.installation, serverInstallation(nativeRuntime));
    assert.equal(existsSync(recordPath(root)), false);
    const start = await command(root, ['server', 'start']);
    assert.equal(start.status, 0, start.stderr);
    await pollUntil(async () => {
      const projection = await command(root, ['workspace', 'projection']);
      return projection.status === 0 ? true : undefined;
    }, { description: 'workspace service accepts its first projection', timeoutMs: 10_000 });
    const owner = record(root);
    const remote = await command(root, ['cache', 'status']);
    assert.equal(remote.status, 0, remote.stderr);
    const serviceStatus = decode(remote.stdout);
    assert.equal(serviceStatus.owner, 'service');
    assert.equal(serviceStatus.pid, owner.pid);
    assert.equal(serviceStatus.installation, owner.installation);
    assert.equal(typeof serviceStatus.sourceDigest, 'string');
  } finally { await stop(root); rmSync(root, { recursive: true, force: true }); }
});
