import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { request } from 'node:http';
import { connect } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from './temporary.ts';
import type { ViewServerHandle } from '../e2e/server.ts';
import type { WorkspaceProjection } from '../../src/model/index.ts';
import { parseWorkspaceProjection, pollUntil } from './support.ts';
export const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-view-'));
  execFileSync('git', ['init', '-q', root]);
  return { root };
};

export interface ResponseResult { readonly status: number; readonly type: string | undefined; readonly body: string }
export function send(server: ViewServerHandle, path: string, options: { readonly method?: string; readonly headers?: Readonly<Record<string, string>>; readonly body?: string } = {}): Promise<ResponseResult> {
  return new Promise((resolve, reject) => {
    // Each probe owns its connection. A pooled idle socket can expire while a
    // synchronous fixture stalls the shared client/server event loop.
    const call = request({ host: '127.0.0.1', port: server.port, path, agent: false, method: options.method ?? 'GET', headers: options.headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.once('end', () => resolve({ status: response.statusCode ?? 0, type: response.headers['content-type'], body: Buffer.concat(chunks).toString('utf8') }));
    });
    call.once('error', reject);
    if (options.body !== undefined) call.write(options.body);
    call.end();
  });
}

export function sendRaw(server: ViewServerHandle, requestText: string): Promise<ResponseResult> {
  return new Promise((resolve, reject) => {
    const socket = connect(server.port, '127.0.0.1', () => socket.end(requestText));
    const chunks: Buffer[] = [];
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.once('error', reject);
    socket.once('end', () => {
      const response = Buffer.concat(chunks).toString('utf8');
      const separator = response.indexOf('\r\n\r\n');
      const head = separator === -1 ? response : response.slice(0, separator);
      const body = separator === -1 ? '' : response.slice(separator + 4);
      const status = Number(/^HTTP\/1\.1 ([0-9]{3})/u.exec(head)?.[1] ?? '0');
      const type = /^content-type:\s*(.+)$/imu.exec(head)?.[1]?.trim();
      resolve({ status, type, body });
    });
  });
}

export const parsed = (response: ResponseResult): { readonly ok: boolean; readonly value?: unknown; readonly error?: string } => JSON.parse(response.body) as { readonly ok: boolean; readonly value?: unknown; readonly error?: string };
export const jsonHeaders = { 'content-type': 'application/json' };
export const waitForWorkspace = (server: ViewServerHandle, timeoutMs = 65_000, accepts: (value: WorkspaceProjection) => boolean = () => true): Promise<WorkspaceProjection> => pollUntil(async () => {
  const response = await send(server, '/api/workspace');
  if (response.status !== 200) return undefined;
  const value = parseWorkspaceProjection(response.body);
  return value !== undefined && accepts(value) ? value : undefined;
}, { description: 'workspace projection', timeoutMs });

