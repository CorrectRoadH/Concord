import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Schema } from 'effect';
import { installationResources, installationRootForBin } from '../../src/base/installation/index.js';
import { tmpdir } from '../support/temporary.js';
import { sourceConcord, prepareSourceConsumer } from '../support/installed-package.js';
import { stopWorkspaceServer } from '../support/stop-workspace-server.js';

export interface ViewServerOptions { readonly root: string; readonly host?: string; readonly port?: number; readonly installedBin?: string }
export interface ViewServerHandle {
  readonly root: string; readonly host: string; readonly port: number; readonly address: string;
  readonly process: ChildProcess;
  close(): Promise<void>;
}
const Ready = Schema.Struct({ operation: Schema.Literal('view'), root: Schema.String, host: Schema.String, port: Schema.Number, address: Schema.String });

/** HTTP/browser consumers run the checkout's source CLI. */
export async function startViewServer(options: ViewServerOptions): Promise<ViewServerHandle> {
  const scratch = mkdtempSync(join(tmpdir(), 'concord-browser-server-'));
  let child: ChildProcess | undefined;
  let entry: string | undefined;
  try {
    let resources: ReturnType<typeof installationResources>;
    if (options.installedBin !== undefined) resources = installationResources(installationRootForBin(options.installedBin));
    else {
      const install = join(scratch, 'tool'); mkdirSync(install);
      writeFileSync(join(install, 'package.json'), JSON.stringify({ private: true }));
      prepareSourceConsumer(install, sourceConcord());
      resources = installationResources(join(install, 'node_modules/concord-sdlc'));
    }
    entry = resources.bin;
    child = spawn(process.execPath, [resources.bin, '--root', options.root, '--json', 'view', '--in-process', '--host', options.host ?? '127.0.0.1', '--port', String(options.port ?? 0)], { stdio: ['ignore', 'pipe', 'pipe'] });
    const processHandle = child;
    let diagnostics = '';
    processHandle.stderr!.on('data', (chunk: Buffer) => { diagnostics += chunk.toString(); process.stderr.write(chunk); });
    const ready = await new Promise<Schema.Schema.Type<typeof Ready>>((accept, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(new Error(`Installed View did not start: ${diagnostics}`)), 30_000);
      const cleanup = () => { clearTimeout(timeout); processHandle.off('error', failed); processHandle.off('exit', exited); processHandle.stdout!.off('data', data); };
      const failed = (cause: Error) => { cleanup(); reject(cause); };
      const exited = (code: number | null, signal: NodeJS.Signals | null) => failed(new Error(`Installed View exited code=${code} signal=${signal}: ${output}\n${diagnostics}`));
      const data = (chunk: Buffer) => {
        output += chunk.toString();
        const line = output.split('\n')[0]!;
        if (!output.includes('\n')) return;
        try { const value = Schema.decodeUnknownSync(Schema.fromJsonString(Ready), { onExcessProperty: 'ignore' })(line); cleanup(); accept(value); }
        catch (cause) { failed(new Error(`Invalid View readiness: ${line}`, { cause })); }
      };
      processHandle.once('error', failed); processHandle.once('exit', exited); processHandle.stdout!.on('data', data);
    });
    let closing: Promise<void> | undefined;
    return { ...ready, process: processHandle, close: () => closing ??= (async () => {
      try {
        // Release the service handles before ending its CLI owner.
        stopWorkspaceServer(options.root, resources.bin);
      } finally {
        try { await terminate(processHandle); }
        finally { rmSync(scratch, { recursive: true, force: true }); }
      }
    })() };
  } catch (cause) {
    try { if (entry) stopWorkspaceServer(options.root, entry); }
    finally {
      try { if (child) await terminate(child); }
      finally { rmSync(scratch, { recursive: true, force: true }); }
    }
    throw cause;
  }
}

async function terminate(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const stopped = once(child, 'exit');
  child.kill('SIGTERM');
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([stopped, new Promise<never>((_accept, reject) => {
      deadline = setTimeout(() => reject(new Error('Source View did not stop after SIGTERM')), 5_000);
    })]);
  } catch (cause) {
    child.kill('SIGKILL'); await stopped; throw cause;
  } finally { if (deadline !== undefined) clearTimeout(deadline); }
}
