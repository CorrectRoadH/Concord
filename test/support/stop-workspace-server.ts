import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { genericPrivateDirectorySync } from '../../src/base/publication/index.ts';
import { installedConcordCli } from './support.ts';

/** Stop only the service belonging to this fixture, before removing its sources or installation. */
export function stopWorkspaceServer(root: string, entry = installedConcordCli(), env = process.env, runtime: readonly string[] = []): void {
  if (!existsSync(root)) return;
  const record = join(genericPrivateDirectorySync(root, env), 'server/current.json');
  if (!existsSync(record)) return;
  const instance = readFileSync(record, 'utf8').trim();
  const stopped = spawnSync(process.execPath, [...(entry.endsWith('.ts') ? ['--conditions=concord-source'] : []), ...runtime, entry, '--root', root, '--json', 'server', 'stop'], { env, encoding: 'utf8', timeout: 20_000 });
  const processes = stopped.status === 0 ? '' : spawnSync('ps', ['-axo', 'pid=,ppid=,stat=,command='], { encoding: 'utf8' }).stdout.split('\n').filter(line => line.includes(root)).join('\n');
  assert.equal(stopped.status, 0, `Fixture service cleanup failed for ${root}: ${stopped.stdout}${stopped.stderr}\nTarget: ${instance}\nRemaining record: ${existsSync(record)}\nProcesses: ${processes}`);
  assert.equal(existsSync(record), false, 'server stop confirms instance cleanup');
}
