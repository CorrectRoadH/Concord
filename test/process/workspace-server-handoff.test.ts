// 跨进程保证：服务与 IPC——不同安装或协议在旧 owner 退出后交接；同一安装复用实例。
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { installedConcordCli, pollUntil } from '../support/support.ts';
import { tmpdir } from '../support/temporary.ts';
import { privateSourceInstallation } from '../support/private-source.ts';

import { recordPath, record, fixture, command, stop } from '../support/workspace-server-fixture.ts';
import { makeRuntimeEnvironment, RuntimeEnvironment } from '../../src/base/environment/index.ts';
import { ServerRuntime } from '../../src/base/server-lock/index.ts';

const processExited = (pid: number) => Effect.runPromise(Effect.gen(function*() {
  return yield* (yield* ServerRuntime).processExited(pid);
}).pipe(Effect.provide(ServerRuntime.layer), Effect.provideService(RuntimeEnvironment, makeRuntimeEnvironment(process.cwd(), process.env))));

const workerPid = (root: string, role = 'foreground') => pollUntil(async () => {
  for (const line of execFileSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8' }).split('\n')) {
    const row = /^\s*(\d+)\s+(\d+)\s+(.+)$/u.exec(line);
    if (row && Number(row[2]) === record(root).pid && /\/entry\/server\/compute-worker\.ts(?:\s|$)/u.test(row[3]!) && row[3]!.includes(root) && row[3]!.endsWith(` ${role}`)) return Number(row[1]);
  }
  return undefined;
}, { description: 'installed service owns a real computation process', timeoutMs: 10_000 });

// @use-case docs/feature/cross-platform-release/use-case/install-with-script.md#upgrade-running-service
test('another installation replaces the same protocol service and concurrent callers reuse the winner', { timeout: 30_000 }, async () => {
  const root = (await fixture()), installation = mkdtempSync(join(tmpdir(), 'concord-server-handoff-'));
  try {
    const entry = privateSourceInstallation(installation);
    const absent = await command(root, ['--server=existing', 'list', 'feature']);
    assert.equal(absent.status, 1, absent.stdout);
    assert.equal(JSON.parse(absent.stderr).error, 'WorkspaceServerUnavailable');
    assert.equal(existsSync(recordPath(root)), false, 'external host mode never launches a service');
    const started = await command(root, ['server', 'start'], entry);
    assert.equal(started.status, 0, started.stderr);
    const before = record(root);
    const inherited = { ...process.env, CONCORD_SERVER_SCOPE: JSON.stringify({ root, privateDir: join(root, '.git/concord'), key: crypto.randomUUID() }) };
    for (const args of [['check'], ['cache', 'status'], ['server', 'start']]) {
      const scoped = await command(root, args, installedConcordCli(), inherited);
      assert.equal(scoped.status, 1, scoped.stdout);
      assert.equal(JSON.parse(scoped.stderr).error, 'WorkspaceServerScopeExpired');
      assert.equal(record(root).token, before.token, 'inherited scopes cannot replace another installation');
      assert.equal(await processExited(before.pid), false);
    }
    const status = await command(root, ['server', 'status']);
    assert.equal(status.status, 0, status.stderr);
    assert.equal(JSON.parse(status.stdout).compatible, false);
    for (const args of [['list', 'feature'], ['workspace', 'projection']]) {
      const mismatched = await command(root, ['--server=existing', ...args]);
      assert.equal(mismatched.status, 1, mismatched.stdout);
      assert.equal(JSON.parse(mismatched.stderr).error, 'WorkspaceServerUnavailable');
      assert.equal(record(root).token, before.token, 'external host mode never replaces a service');
    }
    const localRead = await command(root, ['--server=existing', 'action', '--input-text', JSON.stringify({ action: 'file.get', path: 'docs/feature/reader/README.md' })]);
    assert.equal(localRead.status, 0, localRead.stderr);
    assert.equal(record(root).token, before.token, 'local reads and status must not replace an installation');
    const queries = await Promise.all([command(root, ['list', 'feature']), command(root, ['list', 'feature'])]);
    for (const query of queries) {
      assert.equal(query.status, 0, query.stderr);
      assert.match(query.stdout, /Reader/);
    }
    const after = record(root);
    assert.notEqual(after.token, before.token);
    assert.notEqual(after.installation, before.installation);
    assert.equal(await processExited(before.pid), true);
    const compatible = await command(root, ['server', 'status']);
    assert.equal(JSON.parse(compatible.stdout).compatible, true);
    const staleStop = await command(root, ['server', 'stop', '--token', before.token]);
    assert.equal(staleStop.status, 0, staleStop.stderr);
    assert.equal(record(root).token, after.token, 'a stale stop token cannot stop the winner');
    const hosted = await command(root, ['--server=existing', 'list', 'feature']);
    assert.equal(hosted.status, 0, hosted.stderr);
    for (const input of [{ action: 'file.get', path: 'docs/feature/reader/README.md' }, { action: 'page.render', path: 'docs/feature/reader/README.md', theme: { background: '#fff', foreground: '#000' } }]) {
      const read = await command(root, ['action', '--input-text', JSON.stringify(input)]);
      assert.equal(read.status, 0, read.stderr);
      assert.equal(record(root).token, after.token);
    }
    const stopped = await command(root, ['server', 'stop', '--token', after.token]);
    assert.equal(stopped.status, 0, stopped.stderr);
    await pollUntil(async () => !existsSync(recordPath(root)) ? true : undefined, { description: 'replacement service releases ownership', timeoutMs: 8000 });
  } finally { await stop(root); rmSync(root, { recursive: true, force: true }); rmSync(installation, { recursive: true, force: true }); }
});

// @feature docs/feature/local-data-engine/architecture.md#启动与裁决
test('a different data protocol retains control frames for automatic service replacement', { timeout: 30_000 }, async () => {
  const root = await fixture(), installation = mkdtempSync(join(tmpdir(), 'concord-protocol-handoff-'));
  const failures: unknown[] = [];
  try {
    const entry = privateSourceInstallation(installation);
    for (const path of ['src/model/workspace-protocol.ts']) {
      const target = join(installation, path);
      writeFileSync(target, readFileSync(target, 'utf8').replaceAll('concord.workspace/v3', 'concord.workspace/takeover-fixture'));
    }
    const started = await command(root, ['server', 'start'], entry);
    assert.equal(started.status, 0, started.stderr);
    const before = record(root);
    const query = await command(root, ['check']);
    assert.equal(query.status, 0, query.stderr);
    assert.notEqual(record(root).token, before.token);
    assert.equal(await processExited(before.pid), true);
  } catch (cause) { failures.push(cause); } finally {
    try {
      await stop(root);
      for (const path of [root, installation]) {
        try { rmSync(path, { recursive: true, force: true }); } catch (cause) { failures.push(cause); }
      }
    } catch (cause) { failures.push(cause); }
  }
  if (failures.length) throw new AggregateError(failures, `Protocol handoff fixture failed; root: ${root}; installation: ${installation}`);
});

// @feature docs/feature/local-data-engine/architecture.md#启动与裁决
test('a new installation automatically replaces a service with a failed computation', { timeout: 30_000 }, async () => {
  const root = await fixture(), installation = mkdtempSync(join(tmpdir(), 'concord-compute-fail-'));
  const failures: unknown[] = [];
  try {
    const entry = privateSourceInstallation(installation);
    const started = await command(root, ['server', 'start'], entry);
    assert.equal(started.status, 0, started.stderr);
    const before = record(root);
    const pid = await workerPid(root);
    writeFileSync(join(installation, 'src/entry/server/compute-worker.ts'), 'process.exit(1);\n');
    process.kill(pid, 'SIGKILL');
    const query = await command(root, ['check'], entry);
    assert.equal(query.status, 1, query.stdout + query.stderr);
    assert.equal(JSON.parse(query.stderr).error, 'WorkspaceComputeExited', query.stderr);
    assert.equal(record(root).token, before.token);
    const retry = await command(root, ['check']);
    assert.equal(retry.status, 0, retry.stderr);
    assert.notEqual(record(root).token, before.token);
    assert.equal(await processExited(before.pid), true);
  } catch (cause) { failures.push(cause); } finally {
    try {
      await stop(root);
      for (const path of [root, installation]) {
        try { rmSync(path, { recursive: true, force: true }); } catch (cause) { failures.push(cause); }
      }
    } catch (cause) { failures.push(cause); }
  }
  if (failures.length) throw new AggregateError(failures, `Compute fail fixture failed; root: ${root}; installation: ${installation}`);
});


// @feature docs/engineering/build/architecture.md#从源码运行
test('source HEAD changes replace the service while uncommitted edits reuse it', { timeout: 45_000 }, async () => {
  const root = (await fixture()), installation = mkdtempSync(join(tmpdir(), 'concord-source-reload-'));
  let entry = '';
  try {
    const tool = join(installation, 'source');
    entry = privateSourceInstallation(tool);
    const start = await command(root, ['server', 'start'], entry);
    assert.equal(start.status, 0, start.stderr);
    const before = record(root);
    writeFileSync(join(tool, 'src/source-reload-fixture.ts'), 'export {};\n');
    const query = await command(root, ['list', 'feature'], entry);
    assert.equal(query.status, 0, query.stderr);
    assert.equal(record(root).token, before.token);
    assert.equal(record(root).sourceDigest, before.sourceDigest);
    execFileSync('git', ['-C', tool, 'add', 'src/source-reload-fixture.ts']);
    execFileSync('git', ['-C', tool, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Change source HEAD']);
    const restarted = await command(root, ['list', 'feature'], entry);
    assert.equal(restarted.status, 0, restarted.stderr);
    const after = record(root);
    assert.notEqual(after.token, before.token);
    assert.notEqual(after.installation, before.installation);
    assert.equal(after.sourceDigest, execFileSync('git', ['-C', tool, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
    assert.notEqual(after.sourceDigest, before.sourceDigest);
    assert.equal(await processExited(before.pid), true);
    assert.equal((await command(root, ['server', 'stop'], entry)).status, 0);
    assert.equal(existsSync(recordPath(root)), false);
    rmSync(join(tool, '.git'), { recursive: true });
    const missing = await command(root, ['server', 'start'], entry);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /SourceRevisionUnavailable/);
    assert.equal(existsSync(recordPath(root)), false);
  } finally { if (entry) await command(root, ['server', 'stop'], entry); rmSync(root, { recursive: true, force: true }); rmSync(installation, { recursive: true, force: true }); }
});
