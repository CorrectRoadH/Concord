// 跨进程保证：服务与 IPC——前台服务将真实HTTP失败代码写入stderr且只一条，日志不泄露请求目标或诊断。
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import test from 'node:test';
import { Schema } from 'effect';
import { startViewServer, type ViewServerHandle } from '../e2e/server.ts';
import { installedConcordCli, pollUntil } from '../support/support.ts';
import { fixture, send, parsed } from '../support/view-http-fixture.ts';

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('view writes request failure codes without copying request targets or diagnostics into logs', async () => {
  const { root } = fixture();
  const cli = installedConcordCli();
  const service = spawn(process.execPath, [cli, '--root', root, '--json', 'server', 'run'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const stopped = new Promise<void>(resolve => service.once('exit', () => resolve()));
  const logs: string[] = [];
  service.stderr.on('data', (chunk: Buffer) => logs.push(chunk.toString()));
  let server: ViewServerHandle | undefined;
  try {
    await pollUntil(async () => {
      const status = spawnSync(process.execPath, [cli, '--root', root, '--json', 'server', 'status'], { encoding: 'utf8', timeout: 10_000 });
      return status.status === 0 && Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ state: Schema.String })))(status.stdout).state === 'running' ? true : undefined;
    }, { description: 'foreground workspace service accepts clients', timeoutMs: 10_000 });
    server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
    const result = await send(server, '/api/missing?token=private');
    assert.equal(result.status, 404);
    assert.equal(parsed(result).error, 'ApiNotFound');
    await pollUntil(async () => logs.some(line => line.includes('ApiNotFound')) ? true : undefined, { description: 'the foreground service forwards its sanitized request failure log' });
    assert.equal(logs.length, 1);
    assert.match(logs[0]!, /"status":404,"code":"ApiNotFound"/u);
    assert.doesNotMatch(logs[0]!, /private|\/api\/missing|message|details|stack/u);
  } finally {
    try { await server?.close(); }
    finally {
      if (service.exitCode === null && service.signalCode === null) service.kill('SIGTERM');
      await stopped;
      rmSync(root, { recursive: true, force: true });
    }
  }
});
