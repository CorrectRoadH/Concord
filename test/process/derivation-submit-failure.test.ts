// 跨进程保证：服务与 IPC——派生缓存提交前服务消失仍返回具名JSON错误，不输出运行时日志。
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { command, fixture, record, recordPath, stop } from '../support/workspace-server-fixture.ts';

// @feature docs/feature/local-data-engine/README.md
test('discovery reports CacheUpdateFailed as JSON when its cache owner disappears after collection', { timeout: 60_000 }, async () => {
  const root = (await fixture());
  const source = fileURLToPath(new URL('../..', import.meta.url));
  try {
    mkdirSync(join(root, 'test'));
    writeFileSync(join(root, 'test/sample.ts'), '// @feature docs/feature/reader/README.md\n// @name collected-once\n');
    writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
    symlinkSync(join(source, 'node_modules'), join(root, 'node_modules'), 'dir');
    const adapter = readFileSync(join(source, 'test/fixtures/process-adapter.ts'), 'utf8').replace(
      "const file = (request.payload.planContext",
      `writeFileSync(join(root, '.git/concord/collected.txt'), readFileSync(join(root, '.git/concord/collected.txt'), 'utf8') + 'collected\\n');
    const owner = JSON.parse(readFileSync(join(root, '.git/concord/server/current.json'), 'utf8')) as { pid: number };
    process.kill(owner.pid, 'SIGKILL');
    for (;;) {
      try { process.kill(owner.pid, 0); } catch { break; }
      yield* Effect.sleep('10 millis');
    }
    const file = (request.payload.planContext`,
    );
    writeFileSync(join(root, 'adapter.ts'), adapter);
    writeFileSync(join(root, '.git/concord/collected.txt'), '');
    writeFileSync(join(root, 'mode.txt'), 'green');
    writeFileSync(join(root, 'concord.config.ts'), `export default ${JSON.stringify({ testRoots: ['test'], testAdapters: [{ id: 'fixture', include: ['test'], argv: [process.execPath, 'adapter.ts'], implementationFiles: ['adapter.ts'], inputRoots: [], lockFiles: [], frameworkVersion: 'fixture/v1', envNames: ['PATH'] }] })};\n`);
    const started = await command(root, ['server', 'start']);
    assert.equal(started.status, 0, started.stderr);
    const discovered = await command(root, ['test', 'discover']);
    assert.equal(readFileSync(join(root, '.git/concord/collected.txt'), 'utf8'), 'collected\n');
    assert.equal(discovered.status, 1, discovered.stderr);
    assert.equal(discovered.stdout, '', 'failure must not leak Effect logs or successful output');
    const error = JSON.parse(discovered.stderr);
    assert.equal(error.error, 'CacheUpdateFailed');
    assert.match(JSON.stringify(error.details), /WorkspaceServerUnavailable|Socket|EPIPE|closed|transport/iu);
  } finally {
    let alive = false;
    if (existsSync(recordPath(root))) {
      try { process.kill(record(root).pid, 0); alive = true; } catch { /* The fixture deliberately killed this owner. */ }
    }
    if (alive) await stop(root);
    rmSync(root, { recursive: true, force: true });
  }
});
