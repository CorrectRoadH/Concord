import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { Schema } from 'effect';
import { stopWorkspaceServer } from '../support/stop-workspace-server.js';

export interface ViewServerOptions { readonly root: string; readonly host?: string; readonly port?: number; readonly installedBin?: string; readonly signal?: AbortSignal }
export interface ViewServerHandle {
  readonly root: string; readonly host: string; readonly port: number; readonly address: string;
  readonly process: ChildProcess;
  readonly startupOutput: string;
  readonly stderr: string;
  close(): Promise<void>;
}
const Ready = Schema.Struct({ operation: Schema.Literal('view'), root: Schema.String, host: Schema.String, port: Schema.Number, address: Schema.String });

const Manifest = Schema.fromJsonString(Schema.Struct({ bin: Schema.Union([Schema.String, Schema.Record(Schema.String, Schema.String)]) }));

/** Resolve only the package's published bin, without depending on its layout. */
export function installedBrowserBin(packageRoot = process.env.CONCORD_TEST_PACKAGE_ROOT): string {
  if (!packageRoot) throw new Error('CONCORD_TEST_PACKAGE_ROOT must name the gate-built installation');
  const root = resolve(packageRoot);
  const manifest = Schema.decodeUnknownSync(Manifest)(readFileSync(join(root, 'package.json'), 'utf8'));
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin.concord;
  if (!bin) throw new Error('The gate-built package does not declare the concord bin');
  const entry = resolve(root, bin);
  const path = relative(root, entry);
  if (isAbsolute(bin) || path === '..' || path.startsWith('../')) throw new Error('Package bin escapes its installation');
  return entry;
}

export class ViewServerStartupFailed extends Error {
  constructor(readonly root: string, readonly cleanupComplete: boolean, cause: unknown) {
    super(`View startup failed for ${root}; cleanup=${cleanupComplete ? 'complete' : 'unconfirmed'}`, { cause });
    this.name = 'ViewServerStartupFailed';
  }
}

/** Browser consumers start the gate-built package through its published CLI. */
export async function startViewServer(options: ViewServerOptions): Promise<ViewServerHandle> {
  let child: ChildProcess | undefined;
  let entry: string | undefined;
  try {
    entry = options.installedBin ?? installedBrowserBin();
    options.signal?.throwIfAborted();
    child = spawn(process.execPath, [entry, '--root', options.root, '--json', 'view', '--in-process', '--host', options.host ?? '127.0.0.1', '--port', String(options.port ?? 0)], { stdio: ['ignore', 'pipe', 'pipe'] });
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
        // Release the service handles before ending its CLI owner.
        stopWorkspaceServer(options.root, entry);
      } finally { await terminate(processHandle); }
    })().catch(cause => { closing = undefined; throw cause; }) };
  } catch (cause) {
    let cleanupFailure: unknown;
    try { if (entry) stopWorkspaceServer(options.root, entry); }
    catch (error) { cleanupFailure = error; }
    try { if (child) await terminate(child); }
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
