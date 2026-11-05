import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Schema } from 'effect';
import { installedConcordCli, pollUntil } from '../support/support.js';
import { tmpdir } from '../support/temporary.js';

const Record = Schema.Struct({ token: Schema.String, pid: Schema.Int, installation: Schema.String, sourceDigest: Schema.optional(Schema.String), socket: Schema.Struct({ path: Schema.String }) });
export const recordPath = (root: string) => join(root, '.git/concord/server/current.json');
export const record = (root: string) => Schema.decodeUnknownSync(Schema.fromJsonString(Record), { onExcessProperty: 'ignore' })(readFileSync(recordPath(root), 'utf8'));
export const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-workspace-'));
  execFileSync('git', ['init', '-q', root]);
  mkdirSync(join(root, 'docs/feature/reader'), { recursive: true });
  writeFileSync(join(root, 'docs/feature/reader/README.md'), '# Reader\n\nFirst generation.\n');
  return root;
};
export const command = (root: string, args: readonly string[], entry = installedConcordCli()) => new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
  const child = spawn(process.execPath, [entry, '--root', root, '--json', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += String(data); }); child.stderr.on('data', data => { stderr += String(data); });
  child.once('error', reject); child.once('close', status => resolve({ status, stdout, stderr }));
});
// The peer uses the source protocol; the system under test is the installed service.
export const rpcModule = () => import('../../src/entry/server/index.js');
export const stop = async (root: string) => {
  if (existsSync(recordPath(root))) await command(root, ['server', 'stop']);
  await pollUntil(async () => !existsSync(recordPath(root)) ? true : undefined, { description: 'service record removed after confirmed cleanup', timeoutMs: 8000 });
};

