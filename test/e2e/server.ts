import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Schema } from 'effect';
import { installationResources, installationRootForBin } from '../../src/base/installation/index.js';
import { tmpdir } from '../support/temporary.js';
import { packConcord, installConcord } from '../support/installed-package.js';

export interface ViewServerOptions { readonly root: string; readonly host?: string; readonly port?: number; readonly webRoot?: string; readonly installedBin?: string }
export interface ViewServerHandle {
  readonly root: string; readonly host: string; readonly port: number; readonly address: string;
  readonly process: ChildProcess;
  close(): Promise<void>;
}
const Ready = Schema.Struct({ operation: Schema.Literal('view'), root: Schema.String, host: Schema.String, port: Schema.Number, address: Schema.String });

/** Every HTTP/browser consumer starts the invocation's installed public bin. */
export async function startViewServer(options: ViewServerOptions): Promise<ViewServerHandle> {
  const scratch = mkdtempSync(join(tmpdir(), 'concord-browser-server-'));
  let child: ChildProcess | undefined;
  try {
    let resources: ReturnType<typeof installationResources>;
    if (options.installedBin !== undefined) resources = installationResources(installationRootForBin(options.installedBin));
    else {
      const install = join(scratch, 'tool'); mkdirSync(install);
      writeFileSync(join(install, 'package.json'), JSON.stringify({ private: true }));
      installConcord(install, packConcord(scratch), [], { private: options.webRoot !== undefined });
      resources = installationResources(join(install, 'node_modules/concord-sdlc'));
    }
    if (options.webRoot !== undefined) {
      rmSync(resources.web, { recursive: true, force: true });
      cpSync(options.webRoot, resources.web, { recursive: true });
    }
    child = spawn(process.execPath, [resources.bin, '--root', options.root, '--json', 'view', '--host', options.host ?? '127.0.0.1', '--port', String(options.port ?? 0)], { stdio: ['ignore', 'pipe', 'pipe'] });
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
      if (processHandle.exitCode === null && processHandle.signalCode === null) {
        const stopped = once(processHandle, 'exit');
        processHandle.kill('SIGTERM');
        let deadline: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([stopped, new Promise<never>((_accept, reject) => {
            deadline = setTimeout(() => reject(new Error('Installed View did not stop after SIGTERM with an unused socket')), 5_000);
          })]);
        } catch (cause) {
          processHandle.kill('SIGKILL'); await stopped;
          rmSync(scratch, { recursive: true, force: true }); throw cause;
        } finally { if (deadline !== undefined) clearTimeout(deadline); }
      }
      rmSync(scratch, { recursive: true, force: true });
    })() };
  } catch (cause) {
    if (child && child.exitCode === null && child.signalCode === null) { const stopped = once(child, 'exit'); child.kill('SIGTERM'); await stopped; }
    rmSync(scratch, { recursive: true, force: true }); throw cause;
  }
}
