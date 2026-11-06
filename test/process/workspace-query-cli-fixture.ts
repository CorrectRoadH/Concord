import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Effect } from 'effect';
import { acquireTraceLeaseSync, genericPrivateDirectorySync, releaseTraceLeaseSync } from '../../src/base/publication/index.ts';
import { installedConcordCli, pollUntil } from '../support/support.ts';
import { command, fixture, record, recordPath, rpcModule, stop } from '../support/workspace-server-fixture.ts';

function launch(cwd: string, args: readonly string[], env: NodeJS.ProcessEnv = process.env, ipc = false) {
  const child = spawn(process.execPath, [installedConcordCli(), ...args], { cwd, env, stdio: ipc ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout!.on('data', bytes => { stdout += String(bytes); });
  child.stderr!.on('data', bytes => { stderr += String(bytes); });
  const completed = new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    child.once('error', reject);
    child.once(ipc ? 'exit' : 'close', status => resolve({ status, stdout, stderr }));
  });
  return { child, completed };
}
const cli = (root: string, args: readonly string[], env?: NodeJS.ProcessEnv) => launch(root, ['--json', ...args], env).completed;
const gone = (pid: number) => { try { process.kill(pid, 0); return false; } catch { return true; } };
const terminate = (child: ChildProcess) => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); };
export { assert, spawn, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, join, fileURLToPath, test, Effect, acquireTraceLeaseSync, genericPrivateDirectorySync, releaseTraceLeaseSync, installedConcordCli, pollUntil, command, fixture, record, recordPath, rpcModule, stop, launch, cli, gone, terminate };
export type { ChildProcess };
