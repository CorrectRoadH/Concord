import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { Schema } from 'effect';
import { stopWorkspaceServer } from '../support/stop-workspace-server.ts';
import { sourceCli } from '../support/source-consumer.ts';

export interface ViewServerOptions { readonly root: string; readonly host?: string; readonly port?: number; readonly installedBin?: string; readonly signal?: AbortSignal }
export interface ViewServerHandle {
  readonly root: string; readonly host: string; readonly port: number; readonly address: string;
  readonly process: ChildProcess;
  readonly startupOutput: string;
  readonly stderr: string;
  close(): Promise<void>;
}
const Ready = Schema.Struct({ operation: Schema.Literal('view'), root: Schema.String, host: Schema.String, port: Schema.Number, address: Schema.String });

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
  let child: ChildProcess | undefined;
  let entry: string | undefined;
  try {
    entry = options.installedBin ?? sourceCli();
    options.signal?.throwIfAborted();
    // The fixture owns the service explicitly; the View client only owns its HTTP lease.
    child = spawn(process.execPath, [...(entry.endsWith('.ts') ? ['--conditions=concord-source', '--import', new URL('../support/source-runtime.ts', import.meta.url).href] : []), entry, '--root', options.root, '--json', 'view', '--host', options.host ?? '127.0.0.1', '--port', String(options.port ?? 0)], { stdio: ['ignore', 'pipe', 'pipe'] });
    const processHandle = child;
    let diagnostics = '';
    processHandle.stderr!.on('data', (chunk: Buffer) => { diagnostics += chunk.toString(); process.stderr.write(chunk); });
    let startupOutput = '';
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
    return { ...ready, process: processHandle, startupOutput, get stderr() { return diagnostics; }, close: () => closing ??= (async () => {
      try {
        // Release the View client's HTTP lease and RPC transport before stopping its service.
        await terminate(processHandle);
      } finally { stopWorkspaceServer(options.root, entry); }
    })().catch(cause => { closing = undefined; throw cause; }) };
  } catch (cause) {
    let cleanupFailure: unknown;
    try { if (child) await terminate(child); }
    catch (error) { cleanupFailure = error; }
    try { if (entry) stopWorkspaceServer(options.root, entry); }
    catch (error) { cleanupFailure = cleanupFailure ? new AggregateError([cleanupFailure, error]) : error; }
    throw new ViewServerStartupFailed(options.root, cleanupFailure === undefined,
      cleanupFailure ? new AggregateError([cause, cleanupFailure], 'View startup and cleanup failed') : cause);
  }
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
