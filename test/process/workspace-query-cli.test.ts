// 跨进程保证：服务与 IPC——不同子目录的真实CLI复用同一服务，命令作用域在成功和配置失败后回收且不接管已有实例。
import { assert, spawn, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, join, fileURLToPath, test, Effect, acquireTraceLeaseSync, genericPrivateDirectorySync, releaseTraceLeaseSync, installedConcordCli, pollUntil, command, fixture, record, recordPath, rpcModule, stop, launch, cli, gone, terminate, type ChildProcess } from './workspace-query-cli-fixture.ts';


// @feature docs/feature/local-data-engine/README.md
test('queries from two subdirectories automatically share one service and observe later source changes', { timeout: 30_000 }, async () => {
  const root = (await fixture());
  mkdirSync(join(root, 'a')); mkdirSync(join(root, 'b'));
  try {
    const results = await Promise.all(['a', 'b'].map(directory => cli(join(root, directory), ['check'])));
    for (const result of results) assert.equal(result.status, 0, result.stderr);
    const running = record(root);
    assert.equal((await cli(join(root, 'a'), ['server', 'status'])).status, 0);
    assert.equal(record(root).token, running.token);
    writeFileSync(join(root, 'docs/feature/reader/README.md'), '---\nunknownField: true\n---\n# Reader\n');
    const changed = await cli(join(root, 'b'), ['check']);
    assert.equal(changed.status, 1, changed.stderr);
    assert.equal(JSON.parse(changed.stdout).ok, false);
    assert.equal(record(root).token, running.token);
    assert.equal(existsSync(join(root, 'a/.git')), false);
    assert.equal(existsSync(join(root, 'b/.git')), false);
  } finally { await stop(root); rmSync(root, { recursive: true, force: true }); }
});


// @feature docs/feature/local-data-engine/README.md
test('command query cleanup precedes success and configuration failure, and never stops an existing service', { timeout: 30_000 }, async () => {
  const root = (await fixture());
  try {
    const success = await cli(root, ['--server=command', 'check']);
    assert.equal(success.status, 0, success.stderr);
    assert.equal(existsSync(recordPath(root)), false);
    writeFileSync(join(root, 'concord.config.ts'), 'export default (() => ({}))();\n');
    const invalid = await cli(root, ['--server=command', 'check']);
    assert.equal(invalid.status, 1);
    assert.equal(JSON.parse(invalid.stderr).error, 'InvalidConfigSyntax');
    assert.equal(existsSync(recordPath(root)), false);
    assert.equal((await command(root, ['server', 'start'])).status, 0);
    const running = record(root);
    const rejected = await cli(root, ['--server=command', 'check']);
    assert.equal(JSON.parse(rejected.stderr).error, 'WorkspaceServerBusy');
    assert.equal(record(root).token, running.token);
    const diagnostic = await cli(root, ['check']);
    assert.equal(JSON.parse(diagnostic.stderr).error, 'InvalidConfigSyntax');
    assert.equal(record(root).token, running.token);
  } finally { await stop(root); rmSync(root, { recursive: true, force: true }); }
});
