// 跨进程保证：进程终止与信号——命令scope父CLI死亡或IPC断开时服务退出并移除socket，长期计算按每位调用者环境判定observation身份。
import { assert, spawn, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, join, fileURLToPath, test, Effect, acquireTraceLeaseSync, genericPrivateDirectorySync, releaseTraceLeaseSync, installedConcordCli, pollUntil, command, fixture, record, recordPath, rpcModule, stop, launch, cli, gone, terminate, type ChildProcess } from './workspace-query-cli-fixture.ts';


// @feature docs/feature/local-data-engine/README.md
test('inherited command scopes reject other roots and HTTP, and parent disconnect releases the instance', { timeout: 30_000 }, async () => {
  const root = fixture(), other = fixture();
  const scope = { root, privateDir: genericPrivateDirectorySync(root), key: crypto.randomUUID() };
  const env = { ...process.env, CONCORD_SERVER_SCOPE: JSON.stringify(scope) };
  const server = launch(root, ['server', 'run', '--root', root], env, true);
  try {
    await pollUntil(async () => existsSync(recordPath(root)) ? true : undefined, { description: 'command service publishes its real socket', timeoutMs: 10_000 });
    const running = record(root);
    const accepted = await cli(root, ['check'], env); assert.equal(accepted.status, 0, accepted.stderr);
    const excluded = await cli(root, ['check']); assert.equal(JSON.parse(excluded.stderr).error, 'WorkspaceServerScoped');
    const mismatch = await cli(other, ['check'], env); assert.equal(JSON.parse(mismatch.stderr).error, 'WorkspaceServerScopeMismatch');
    const dryMismatch = await cli(other, ['--dry-run', 'check'], env); assert.equal(JSON.parse(dryMismatch.stderr).error, 'WorkspaceServerScopeMismatch');
    assert.equal(existsSync(recordPath(other)), false);
    const rpc = await rpcModule();
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const connection = yield* rpc.connectWorkspaceSocket(running.socket.path, running.installation, running.token, scope.key);
      const result = yield* Effect.result(rpc.requestWorkspace(connection, 'http', { action: 'open', host: '127.0.0.1', port: 0 }));
      assert.equal(result._tag, 'Failure');
      if (result._tag === 'Failure') assert.equal((result.failure as { code: string }).code, 'WorkspaceServerScoped');
    })));
    server.child.disconnect();
    const ended = await server.completed; assert.equal(ended.status, 0, ended.stderr);
    assert.equal(existsSync(recordPath(root)), false);
    assert.equal(existsSync(running.socket.path), false);
    const expired = await cli(root, ['check'], env); assert.equal(JSON.parse(expired.stderr).error, 'WorkspaceServerScopeExpired');
    assert.equal(existsSync(recordPath(root)), false);
  } finally { terminate(server.child); await server.completed; rmSync(root, { recursive: true, force: true }); rmSync(other, { recursive: true, force: true }); }
});


// @feature docs/feature/local-data-engine/README.md
test('killing the owning CLI ends its command service through IPC even while a query waits on publication', { timeout: 30_000 }, async () => {
  const root = fixture();
  const lease = acquireTraceLeaseSync(root, 'exclusive', 'query-scope-test')!;
  const owner = launch(root, ['--json', '--server=command', 'check']);
  let running: ReturnType<typeof record> | undefined;
  try {
    await pollUntil(async () => existsSync(recordPath(root)) ? true : undefined, { description: 'owned command service starts', timeoutMs: 10_000 });
    running = record(root);
    owner.child.kill('SIGKILL'); await owner.completed;
    await pollUntil(async () => !existsSync(recordPath(root)) && gone(running!.pid) ? true : undefined, { description: 'owner disconnect stops service and removes its record', timeoutMs: 10_000 });
    assert.equal(existsSync(running.socket.path), false);
  } finally {
    terminate(owner.child); await owner.completed;
    releaseTraceLeaseSync(lease, 'query-scope-test');
    if (running && !gone(running.pid)) process.kill(running.pid, 'SIGTERM');
    rmSync(root, { recursive: true, force: true });
  }
});


// @feature docs/feature/local-data-engine/README.md
test('a warm query process checks native observation identity against each client environment without inheriting credentials', { timeout: 40_000 }, async () => {
  const root = fixture();
  const source = fileURLToPath(new URL('../..', import.meta.url));
  const secret = `query-environment-${crypto.randomUUID()}`;
  const env = { ...process.env, CONCORD_QUERY_FIXTURE: secret };
  try {
    mkdirSync(join(root, 'test'));
    writeFileSync(join(root, 'test/sample.ts'), '// @feature docs/feature/reader/README.md\n// @name query-environment\n');
    writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
    symlinkSync(join(source, 'node_modules'), join(root, 'node_modules'), 'dir');
    copyFileSync(join(source, 'test/fixtures/process-adapter.ts'), join(root, 'adapter.ts'));
    writeFileSync(join(root, 'mode.txt'), 'green');
    writeFileSync(join(root, 'concord.config.ts'), `export default ${JSON.stringify({ testRoots: ['test'], testAdapters: [{ id: 'fixture', include: ['test'], argv: [process.execPath, 'adapter.ts'], implementationFiles: ['adapter.ts'], inputRoots: [], lockFiles: [], frameworkVersion: 'fixture/v1', envNames: ['PATH', 'CONCORD_QUERY_FIXTURE'] }] })};\n`);
    const collected = await cli(root, ['test', 'discover'], env); assert.equal(collected.status, 0, collected.stderr);
    const first = await cli(root, ['test', 'list'], env); assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(first.stdout).observations[0].observation.current, true);
    const running = record(root);
    const missing = { ...process.env }; delete missing.CONCORD_QUERY_FIXTURE;
    const second = await cli(root, ['test', 'list'], missing); assert.equal(second.status, 0, second.stderr);
    assert.equal(JSON.parse(second.stdout).observations[0].observation.current, false);
    const third = await cli(root, ['test', 'list'], env); assert.equal(third.status, 0, third.stderr);
    assert.equal(JSON.parse(third.stdout).observations[0].observation.current, true);
    assert.equal(record(root).token, running.token);
    assert.equal([first.stdout, second.stdout, third.stdout, readFileSync(recordPath(root), 'utf8')].join('').includes(secret), false);
    const recollected = await cli(root, ['test', 'discover'], missing); assert.equal(recollected.status, 0, recollected.stderr);
    const updated = await cli(root, ['test', 'list'], missing); assert.equal(JSON.parse(updated.stdout).observations[0].observation.current, true);
    const status = await cli(root, ['cache', 'status']); assert.equal(JSON.parse(status.stdout).status, 'ready');
    const rebuilt = await cli(root, ['cache', 'rebuild']); assert.equal(rebuilt.status, 0, rebuilt.stderr);
    await stop(root);
    const persisted = await cli(root, ['test', 'list'], missing); assert.equal(JSON.parse(persisted.stdout).observations[0].observation.current, true);
  } finally { await stop(root); rmSync(root, { recursive: true, force: true }); }
});
