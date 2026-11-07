// 跨进程保证：服务与 IPC——首次诊断等待后台投影，客户端中断不取消服务拥有的刷新。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Schema } from 'effect';
import { createConsumer } from '../support/consumer.ts';
import { runCli } from '../support/cli.ts';
import { createDocument } from '../support/operations.ts';
import { LocalRepository } from '../support/repository.ts';
import { sourceCli } from '../support/source-consumer.ts';
import { stopWorkspaceServer } from '../support/stop-workspace-server.ts';
import { packedEnvelope } from '../support/asynchronous-projections-fixture.ts';
import { pollUntil } from '../support/support.ts';

const Projection = Schema.Struct({ projection: Schema.Struct({ current: Schema.Literal(false), builtAt: Schema.String }) });
const Pending = Schema.Struct({ error: Schema.Literal('QueryPending'), details: Schema.Struct({ refresh: Schema.Struct({ code: Schema.String }) }) });
function consumer() {
  const root = createConsumer(), repo = new LocalRepository(root);
  try { createDocument(repo, 'feature', { id: 'sample', title: 'Sample' }); }
  finally { repo.close(); }
  return root;
}

// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md#first-run
test('first diagnostic CLI waits for a published projection and keeps JSON output atomic', async t => {
  for (const json of [true, false]) await t.test(json ? 'JSON' : 'human', async () => {
    const root = consumer();
    try {
      const result = await runCli({ argv: ['--root', root, ...(json ? ['--json'] : []), 'trace', 'show', 'docs/feature/sample/README.md'], cwd: root, env: process.env, signal: t.signal });
      assert.equal(result.exitCode, 0, result.stdout + result.stderr);
      if (json) {
        const value = Schema.decodeUnknownSync(Schema.fromJsonString(Projection), { onExcessProperty: 'ignore' })(result.stdout);
        assert.equal(value.projection.current, false);
        assert.equal(result.stderr, '');
      } else {
        assert.match(result.stderr, /Building diagnostic snapshot…/u);
        assert.match(result.stdout, /Diagnostic snapshot: .+ \(historical; refresh requested\)/u);
      }
    } finally { stopWorkspaceServer(root); rmSync(root, { recursive: true, force: true }); }
  });
});

// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md#first-run
test('first diagnostic CLI reports the failed refresh instead of a pending request', async t => {
  const root = consumer();
  try {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/broken.ts'), '// @concord-file\n// @concord-implements docs/feature/missing/README.md\nexport const broken = true;\n');
    const result = await runCli({ argv: ['--root', root, '--json', 'trace', 'gaps'], cwd: root, env: process.env, signal: t.signal });
    assert.equal(result.exitCode, 1, result.stdout + result.stderr);
    assert.equal(result.stdout, '');
    const value = Schema.decodeUnknownSync(Schema.fromJsonString(Pending), { onExcessProperty: 'ignore' })(result.stderr);
    assert.equal(value.details.refresh.code, 'TraceInvalid');
  } finally { stopWorkspaceServer(root); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md#first-run
test('interrupting the first diagnostic CLI leaves its requested refresh alive', async t => {
  const root = consumer();
  const child = spawn(process.execPath, [sourceCli(), '--root', root, 'trace', 'gaps'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  const exited = new Promise<void>(resolve => child.once('close', () => resolve()));
  try {
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', () => reject(new Error(`CLI exited before announcing its wait: ${stderr}`)));
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
        if (stderr.includes('Building diagnostic snapshot…')) resolve();
      });
      t.signal.addEventListener('abort', () => reject(t.signal.reason), { once: true });
    });
    child.kill('SIGTERM');
    await exited;
    await pollUntil(async () => (await packedEnvelope(root, ['trace', 'gaps'])).record, { timeoutMs: 30_000, description: 'refresh survives the first client interruption' });
    const result = await runCli({ argv: ['--root', root, '--json', 'trace', 'gaps'], cwd: root, env: process.env, signal: t.signal });
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(Projection), { onExcessProperty: 'ignore' })(result.stdout).projection.current, false);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
    stopWorkspaceServer(root); rmSync(root, { recursive: true, force: true });
  }
});
