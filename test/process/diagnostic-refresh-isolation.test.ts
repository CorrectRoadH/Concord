// 跨进程保证：服务与 IPC——后台诊断扫描停在文件系统边界时仍可读取已发布投影。
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { createConsumer } from '../support/consumer.ts';
import { runCli } from '../support/cli.ts';
import { createDocument } from '../support/operations.ts';
import { LocalRepository } from '../support/repository.ts';
import { sourceCli } from '../support/source-consumer.ts';
import { stopWorkspaceServer } from '../support/stop-workspace-server.ts';
import { pollUntil } from '../support/support.ts';

// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md#historical
// @issue docs/issues/warm-reads-over-budget.md
test('historical reads finish while the requested diagnostic scan is blocked', { timeout: 60_000 }, async () => {
  const root = (await createConsumer()), repo = (await LocalRepository.open(root));
  try { (await createDocument(repo, 'feature', { id: 'sample', title: 'Sample' })); }
  finally { repo.close(); }
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/refresh-gate.ts'), '// @concord-file\n// @concord-implements docs/feature/sample/README.md\nexport const sample = true;\n');
  const hold = join(root, '.git/hold-scan'), reached = join(root, '.git/scan-reached'), hook = join(root, '.git/scan-gate.ts');
  // Delay only the external filesystem boundary. The real scanner, projection,
  // transport and cache remain in use on both sides of the process boundary.
  writeFileSync(hook, `import fs from 'node:fs';
import { mock as bunMock } from 'bun:test';
const syncBuiltinESMExports = () => bunMock.module('node:fs', () => ({ ...fs, default: fs }));
const original = fs.openSync;
fs.openSync = function(path, ...args) {
  if (String(path).endsWith('/src/refresh-gate.ts') && fs.existsSync(${JSON.stringify(hold)})) {
    fs.writeFileSync(${JSON.stringify(reached)}, String(process.pid));
    while (fs.existsSync(${JSON.stringify(hold)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  return original.call(this, path, ...args);
};
syncBuiltinESMExports();
`);
  const env = { ...process.env, BUN_OPTIONS: `${process.env.BUN_OPTIONS ?? ''} --preload=${pathToFileURL(hook).href}` };
  const invoke = async (signal?: AbortSignal) => runCli({ argv: ['--root', root, '--json', 'trace', 'gaps'], cwd: root, env, signal });
  let pending: ReturnType<typeof invoke> | undefined;
  try {
    const first = await invoke();
    assert.equal(first.exitCode, 0, first.stdout + first.stderr);
    await pollUntil(async () => {
      const value = await runCli({ argv: ['--root', root, '--json', 'workspace', 'projection'], cwd: root, env });
      return value.exitCode === 0 ? true : undefined;
    }, { description: 'workspace startup scan completes', timeoutMs: 20_000 });
    writeFileSync(hold, 'hold');
    const trigger = await invoke();
    assert.equal(trigger.exitCode, 0, trigger.stdout + trigger.stderr);
    await pollUntil(async () => existsSync(reached) ? true : undefined, { description: 'diagnostic scanner reaches the held source file', timeoutMs: 20_000 });
    pending = invoke(AbortSignal.timeout(5000));
    const result = await pending;
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    assert.equal(existsSync(hold), true, 'the scan has not been released');
  } finally {
    rmSync(hold, { force: true });
    await pending?.catch(() => undefined);
    stopWorkspaceServer(root, sourceCli(), env);
    rmSync(root, { recursive: true, force: true });
  }
});
