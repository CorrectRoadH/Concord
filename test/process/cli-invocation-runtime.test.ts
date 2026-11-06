// 跨进程保证：运行环境——真实 entry 的帮助、分组命令、skill 与参数错误和进程内程序逐字一致。
// 跨进程保证：进程终止与信号——取消进程内 CLI 后，真实 runner 及后代 PID/socket 已退出，宿主信号监听已释放。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, connect, type Socket } from 'node:net';
import { constants, homedir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Schema } from 'effect';
import { deriveTestReference } from '../../src/model/index.ts';
import { runCli, type CliResult } from '../support/cli.ts';
import { createConsumer, retainConsumer } from '../support/consumer.ts';
import { createDocument } from '../support/operations.ts';
import { LocalRepository } from '../support/repository.ts';
import { readProjectConfig, writeProjectConfig } from '../support/support.ts';

const entry = fileURLToPath(new URL('../../src/entry/cli/entry.ts', import.meta.url));
const plainEnvironment = (): NodeJS.ProcessEnv => ({ ...process.env, NO_COLOR: '1', TERM: 'dumb', FORCE_COLOR: undefined, COLUMNS: '80', LINES: '24' });

async function runEntry(argv: readonly string[], cwd: string, env: NodeJS.ProcessEnv, signal: AbortSignal): Promise<CliResult> {
  const child = spawn(process.execPath, ['--conditions=concord-source', entry, ...argv], { cwd, env, signal, stdio: ['pipe', 'pipe', 'pipe'] });
  const stdout: Buffer[] = [], stderr: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => stdout.push(Buffer.from(chunk)));
  child.stderr.on('data', (chunk: Buffer) => stderr.push(Buffer.from(chunk)));
  child.stdin.end();
  return await new Promise((resolve, reject) => {
    let failure: Error | undefined;
    child.once('error', error => { failure = error; });
    child.once('close', (code, signal) => {
      const result = { stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), exitCode: code ?? -1 };
      if (failure !== undefined) reject(failure);
      else if (signal !== null) reject(new Error(`CLI entry terminated with ${signal}: ${JSON.stringify(result)}`));
      else resolve(result);
    });
  });
}

// @feature docs/engineering/testing/architecture.md#进程内-cli
test('real startup output agrees byte for byte with the captured full command program', async t => {
  const root = createConsumer();
  try {
    const env = plainEnvironment();
    const rows = [
      { name: 'help', argv: ['--help'], exitCode: 0 },
      { name: 'group command', argv: ['--json', 'template', 'show', 'feature', '--title', '真实入口 🧭'], exitCode: 0 },
      { name: 'skill', argv: ['--skill', 'init'], exitCode: 0 },
      { name: 'parameter failure', argv: ['--json', 'template', 'show'], exitCode: 1 },
    ];
    for (const row of rows) await t.test(row.name, async current => {
      const captured = await runCli({ argv: row.argv, cwd: root, env });
      const launched = await runEntry(row.argv, root, env, current.signal);
      assert.equal(captured.exitCode, row.exitCode, captured.stderr);
      assert.deepEqual(launched, captured, `${row.name}: production startup and runCli must have identical streams and exit status`);
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

const Ready = Schema.Struct({
  role: Schema.Literals(['runner', 'descendant']),
  pid: Schema.Int.check(Schema.isGreaterThan(0)),
  port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
  cwd: Schema.String,
  value: Schema.NullOr(Schema.String),
  home: Schema.NullOr(Schema.String),
});
type Ready = typeof Ready.Type;
const decodeReady = Schema.decodeUnknownSync(Schema.fromJsonString(Ready), { onExcessProperty: 'error' });

/** A successful connection observes a listener; refusal proves it has closed. */
async function isListening(port: number): Promise<boolean> {
  return await new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', (error: NodeJS.ErrnoException) => {
      socket.destroy();
      if (error.code === 'ECONNREFUSED') resolve(false);
      else reject(error);
    });
  });
}

function assertExited(pid: number): void {
  // An exited orphan can remain a zombie until the OS reaps its process record.
  if (process.platform === 'linux' && existsSync(`/proc/${pid}/stat`)) {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    assert.match(stat.slice(stat.lastIndexOf(')') + 1), /^\s+[ZX]\s/u, `owned process ${pid} must have exited`);
    return;
  }
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, `owned process ${pid} must have exited`);
}

const signalListeners = () => Object.fromEntries(Object.keys(constants.signals).map(name => [name, process.rawListeners(name)]));

// @feature docs/engineering/testing/architecture.md#进程内-cli
test('abort awaits the real runner and descendant sockets and releases host signal listeners', async () => {
  const root = createConsumer();
  const sockets = new Set<Socket>();
  const records = new Map<Ready['role'], Ready>();
  let resolveReady!: () => void;
  let rejectReady!: (cause: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const server = createServer(socket => {
    sockets.add(socket);
    const chunks: Buffer[] = [];
    socket.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    socket.on('error', rejectReady);
    socket.once('close', () => sockets.delete(socket));
    socket.once('end', () => {
      try {
        const report = decodeReady(Buffer.concat(chunks).toString('utf8'));
        assert.equal(records.has(report.role), false, `one readiness report per ${report.role}`);
        records.set(report.role, report);
        if (records.size === 2) resolveReady();
      } catch (cause) { rejectReady(cause); }
    });
  });
  const controller = new AbortController();
  const before = signalListeners();
  let running: Promise<CliResult> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address !== null && typeof address !== 'string');
    const handshakePort = address.port;
    const childSource = (role: Ready['role']) => `
import { createServer, connect } from 'node:net';
${role === 'runner' ? "import { spawn } from 'node:child_process';\nspawn(process.execPath, ['invocation-child.ts'], { stdio: 'ignore' });" : ''}
const server = createServer(socket => socket.end('alive\\n'));
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('TCP listener has no port');
  const report = { role: ${JSON.stringify(role)}, pid: process.pid, port: address.port, cwd: process.cwd(), value: process.env.CONCORD_ISOLATION_VALUE ?? null, home: process.env.HOME ?? null };
  const handshake = connect({ host: '127.0.0.1', port: ${handshakePort} });
  handshake.end(JSON.stringify(report));
});
`;
    const repo = new LocalRepository(root);
    try { createDocument(repo, 'feature', { id: 'invocation', title: 'Invocation runtime' }); }
    finally { repo.close(); }
    mkdirSync(join(root, 'test'), { recursive: true });
    const file = 'test/invocation.test.ts';
    writeFileSync(join(root, file), "import test from 'node:test';\n// @feature docs/feature/invocation/README.md\n// @name invocation-runtime\ntest('invocation-runtime', () => {});\n");
    writeFileSync(join(root, 'invocation-runner.ts'), childSource('runner'));
    writeFileSync(join(root, 'invocation-child.ts'), childSource('descendant'));
    writeProjectConfig(root, { ...readProjectConfig(root), testRoots: ['test'], sourceRoots: [], runner: {
      kind: 'command', argv: [process.execPath, 'invocation-runner.ts'], sourceFiles: ['invocation-runner.ts', 'invocation-child.ts'], timeoutMs: 5000,
    } });
    const env: NodeJS.ProcessEnv = { ...plainEnvironment(), USERPROFILE: join(root, 'profile'), XDG_CACHE_HOME: process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), CONCORD_ISOLATION_VALUE: 'invocation-only-🧭' };
    delete env.HOME;
    delete env.HERDR_APP_HOME;
    const reference = deriveTestReference(file, file, 'invocation-runtime');
    running = runCli({ argv: ['--json', 'test', 'run', reference], cwd: root, env, signal: controller.signal });
    const completedEarly = running.then(result => { throw new Error(`CLI completed before runner readiness: ${JSON.stringify(result)}`); });
    await Promise.race([ready, completedEarly]);
    for (const role of ['runner', 'descendant'] as const) {
      const report = records.get(role)!;
      assert.equal(report.cwd, root, `${role} inherits the invocation cwd`);
      assert.equal(report.value, 'invocation-only-🧭', `${role} inherits the complete invocation environment`);
      assert.equal(report.home, null, `${role} cannot recover absent HOME from its host`);
      assert.equal(await isListening(report.port), true, `${role} really owns its ready socket`);
    }
    controller.abort();
    await assert.rejects(running);
    for (const report of records.values()) {
      assertExited(report.pid);
      assert.equal(await isListening(report.port), false, `${report.role} socket is gone before runCli rejects`);
    }
    assert.deepEqual(signalListeners(), before, 'cancellation leaves no host signal listener behind');
    const next = await runCli({ argv: ['--json', 'new', 'memory', 'after-cancel'], cwd: root, env });
    assert.equal(next.exitCode, 0, next.stderr);
    assert.equal(next.stderr, '');
    assert.equal(existsSync(join(root, 'memory/after-cancel.md')), true, 'publication is available after runner cancellation');
  } finally {
    controller.abort();
    if (running !== undefined) await Promise.allSettled([running]);
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    try {
      for (const report of records.values()) assertExited(report.pid);
      assert.deepEqual(signalListeners(), before, 'finalization releases host signal listeners even when an assertion fails');
    } catch (cause) { retainConsumer(root); throw cause; }
    rmSync(root, { recursive: true, force: true });
  }
});
