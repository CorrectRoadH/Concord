import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { Effect, Exit, Schema, Scope } from 'effect';
import { readServerRecord } from '../../src/base/server-lock/index.ts';
import { genericPrivateDirectorySync } from '../../src/base/publication/index.ts';
import { connectWorkspaceSocket, requestWorkspace, waitForServerHandshake } from '../../src/entry/server/index.ts';
import { stopWorkspaceServer } from '../support/stop-workspace-server.ts';
import { sourceCli, sourceCliCommand } from '../support/source-consumer.ts';
import { packageCommand } from '../../scripts/package-command.ts';
import { BrowserAttemptTimer } from '../../scripts/gate-timings.ts';

export interface ViewServerOptions { readonly root: string; readonly host?: string; readonly port?: number; readonly installedBin?: string; readonly signal?: AbortSignal; readonly cliView?: boolean }
export interface ViewServerHandle {
  readonly root: string; readonly host: string; readonly port: number; readonly address: string;
  readonly process: ChildProcess;
  readonly startupOutput: string;
  readonly stderr: string;
  close(): Promise<void>;
}
const Ready = Schema.Struct({ operation: Schema.Literal('view'), root: Schema.String, host: Schema.String, port: Schema.Number, address: Schema.String });
const HttpLease = Schema.Struct({ host: Schema.String, port: Schema.Int, address: Schema.String, lease: Schema.String, token: Schema.String });

export class ViewServerStartupFailed extends Error {
  readonly root: string;
  readonly cleanupComplete: boolean;
  constructor(root: string, cleanupComplete: boolean, cause: unknown) {
    super(`View startup failed for ${root}; cleanup=${cleanupComplete ? 'complete' : 'unconfirmed'}`, { cause });
    this.root = root;
    this.cleanupComplete = cleanupComplete;
    this.name = 'ViewServerStartupFailed';
  }
}

/** Browser consumers start the source workspace service through its CLI. */
export async function startViewServer(options: ViewServerOptions): Promise<ViewServerHandle> {
  const end = BrowserAttemptTimer.current?.begin('private-server-start');
  let success = false;
  let child: ChildProcess | undefined;
  let entry: string | undefined;
  let connectionScope: Scope.Closeable | undefined;
  try {
    entry = options.installedBin ?? sourceCli();
    options.signal?.throwIfAborted();
    // Archive consumers and CLI-output tests retain the real View command.
    const direct = !options.installedBin && !options.cliView;
    const [command, ...prefix] = options.installedBin ? packageCommand(entry) : sourceCliCommand(entry);
    child = spawn(command!, [...prefix, '--root', options.root, '--json', ...(direct ? ['server', 'run'] : ['view', '--host', options.host ?? '127.0.0.1', '--port', String(options.port ?? 0)])], { stdio: ['ignore', 'pipe', 'pipe'], ...(options.installedBin ? { env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' } } : {}) });
    const stop = () => {
      if (!options.installedBin) return stopWorkspaceServer(options.root, entry);
      const reply = spawnSync(command!, [...prefix, '--root', options.root, '--json', 'server', 'stop'], { encoding: 'utf8', timeout: 20_000 });
      if (reply.status !== 0) throw new Error(`Installed service cleanup failed: ${reply.stdout}${reply.stderr}`);
    };
    const processHandle = child;
    let diagnostics = '';
    processHandle.stderr!.on('data', (chunk: Buffer) => { diagnostics += chunk.toString(); process.stderr.write(chunk); });
    let startupOutput = '';
    if (direct) {
      const scope = connectionScope = Effect.runSync(Scope.make());
      const startup = new AbortController();
      const failed = (cause: Error) => startup.abort(cause);
      const exited = (code: number | null, signal: NodeJS.Signals | null) => failed(new Error(`Workspace service exited code=${code} signal=${signal}: ${diagnostics}`));
      processHandle.once('error', failed);
      processHandle.once('exit', exited);
      const signal = options.signal ? AbortSignal.any([options.signal, startup.signal]) : startup.signal;
      const lease = await Effect.runPromise(Effect.gen(function*() {
        const record = yield* waitForServerHandshake(Effect.try(() => readServerRecord(genericPrivateDirectorySync(options.root, process.env))).pipe(
          Effect.map(value => value && ['running', 'degraded', 'blocked'].includes(value.state) ? value : undefined),
        ));
        if (record.pid !== processHandle.pid) throw new Error('Direct browser fixture did not acquire its own workspace service');
        const connection = yield* connectWorkspaceSocket(record.socket.path, record.installation, record.token);
        const lease = yield* requestWorkspace(connection, 'http', { action: 'open', host: options.host ?? '127.0.0.1', port: options.port ?? 0 }).pipe(
          Effect.flatMap(value => Schema.decodeUnknownEffect(HttpLease, { onExcessProperty: 'error' })(value)),
        );
        yield* Effect.addFinalizer(() => requestWorkspace(connection, 'http', { action: 'close', host: lease.host, port: lease.port, lease: lease.lease }).pipe(Effect.ignore));
        return lease;
      }).pipe(Scope.provide(scope), Effect.timeout('30 seconds')), { signal }).finally(() => {
        processHandle.off('error', failed); processHandle.off('exit', exited);
      });
      const ready = { root: options.root, host: lease.host, port: lease.port, address: lease.address };
      startupOutput = `${JSON.stringify(ready)}\n`;
      let closing: Promise<void> | undefined;
      success = true;
      return { ...ready, process: processHandle, startupOutput, get stderr() { return diagnostics; }, close: () => closing ??= (async () => {
        try { await Effect.runPromise(Scope.close(scope, Exit.void)); }
        finally { stop(); await terminate(processHandle); }
      })().catch(cause => { closing = undefined; throw cause; }) };
    }
    const ready = await new Promise<Schema.Schema.Type<typeof Ready>>((accept, reject) => {
      let output = '';
      const timeout = setTimeout(() => failed(new Error(`Installed View did not start: ${diagnostics}`)), 30_000);
      const aborted = () => failed(new Error('Installed View startup cancelled'));
      const cleanup = () => { clearTimeout(timeout); options.signal?.removeEventListener('abort', aborted); processHandle.off('error', failed); processHandle.off('exit', exited); processHandle.stdout!.off('data', data); };
      const failed = (cause: Error) => { cleanup(); reject(cause); };
      const exited = (code: number | null, signal: NodeJS.Signals | null) => failed(new Error(`Installed View exited code=${code} signal=${signal}: ${output}\n${diagnostics}`));
      const data = (chunk: Buffer) => {
        output += chunk.toString(); startupOutput = output;
        const line = output.split('\n')[0]!;
        if (!output.includes('\n')) return;
        try { const value = Schema.decodeUnknownSync(Schema.fromJsonString(Ready), { onExcessProperty: 'ignore' })(line); cleanup(); accept(value); }
        catch (cause) { failed(new Error(`Invalid View readiness: ${line}`, { cause })); }
      };
      options.signal?.addEventListener('abort', aborted, { once: true });
      processHandle.once('error', failed); processHandle.once('exit', exited); processHandle.stdout!.on('data', data);
      if (options.signal?.aborted) aborted();
    });
    let closing: Promise<void> | undefined;
    success = true;
    return { ...ready, process: processHandle, startupOutput, get stderr() { return diagnostics; }, close: () => closing ??= (async () => {
      try {
        // Release the View client's HTTP lease and RPC transport before stopping its service.
        await terminate(processHandle);
      } finally { stop(); }
    })().catch(cause => { closing = undefined; throw cause; }) };
  } catch (cause) {
    let cleanupFailure: unknown;
    try { if (connectionScope) await Effect.runPromise(Scope.close(connectionScope, Exit.void)); }
    catch (error) { cleanupFailure = error; }
    try { if (child) await terminate(child); }
    catch (error) { cleanupFailure = error; }
    try {
      if (entry && options.installedBin) {
        const [command, ...prefix] = packageCommand(entry);
        const reply = spawnSync(command, [...prefix, '--root', options.root, '--json', 'server', 'stop'], { encoding: 'utf8', timeout: 20_000 });
        if (reply.status !== 0) throw new Error(`Installed service cleanup failed: ${reply.stdout}${reply.stderr}`);
      } else if (entry) stopWorkspaceServer(options.root, entry);
    }
    catch (error) { cleanupFailure = cleanupFailure ? new AggregateError([cleanupFailure, error]) : error; }
    throw new ViewServerStartupFailed(options.root, cleanupFailure === undefined,
      cleanupFailure ? new AggregateError([cause, cleanupFailure], 'View startup and cleanup failed') : cause);
  } finally { end?.(success); }
}

async function terminate(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const stopped = once(child, 'exit');
  child.kill('SIGTERM');
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([stopped, new Promise<never>((_accept, reject) => {
      deadline = setTimeout(() => reject(new Error('Installed View did not stop after SIGTERM')), 5_000);
    })]);
  } catch (cause) {
    child.kill('SIGKILL'); await stopped; throw cause;
  } finally { if (deadline !== undefined) clearTimeout(deadline); }
}
