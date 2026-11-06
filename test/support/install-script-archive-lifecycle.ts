import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Schema } from 'effect';
import { run, withInstallerAsync } from './install-script-fixture.ts';
import { publishArchiveCandidate } from './archive-installer-assets.ts';

// @use-case docs/feature/cross-platform-release/use-case/install-with-script.md#upgrade-running-service
export const verifyArchiveInstallerLifecycle = (archiveRoot: string, archive?: string) => withInstallerAsync(async f => {
  const changed = join(f.scratch, 'installation-b'); cpSync(archiveRoot, changed, { recursive: true, verbatimSymlinks: true });
  // Distinct bytes model another release without rebuilding or replacing native code.
  appendFileSync(join(changed, 'app/dist/entry/cli/entry.js'), '\n// Installation B lifecycle fixture.\n');
  publishArchiveCandidate(f, '0.9.1', archiveRoot, archive); f.publishArchive('0.9.2', changed); f.succeed('0.9.1');
  const root = join(f.scratch, 'project'), other = join(f.scratch, 'other-project');
  for (const directory of [root, other]) { mkdirSync(directory); const git = run(['git', 'init', directory], f.env, f.scratch); assert.equal(git.status, 0, git.stderr); }
  const command = (directory: string, args: string[]) => new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(f.bin, ['--root', directory, '--json', ...args], { env: f.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += String(data); }); child.stderr.on('data', data => { stderr += String(data); });
    child.once('error', reject); child.once('close', status => resolve({ status, stdout, stderr }));
  });
  const Record = Schema.fromJsonString(Schema.Struct({ pid: Schema.Int, token: Schema.String, installation: Schema.String }));
  const record = (directory: string) => Schema.decodeUnknownSync(Record)(readFileSync(join(directory, '.git/concord/server/current.json'), 'utf8'));
  const marker = (version: string, pid: number) => join(f.root, version, '.in-use', String(pid));
  const ok = async (directory: string, args: string[]) => { const result = await command(directory, args); assert.equal(result.status, 0, result.stdout + result.stderr); return result; };
  try {
    for (const directory of [root, other]) { await ok(directory, ['init', '--docs-only', '--yes']); await ok(directory, ['server', 'start']); }
    const a = record(root), unrelated = record(other);
    assert.equal(existsSync(marker('0.9.1', a.pid)), true); assert.equal(existsSync(marker('0.9.1', unrelated.pid)), true);
    f.succeed('0.9.2');
    const conflict = await command(root, ['list', 'feature']); assert.equal(conflict.status, 1, conflict.stdout + conflict.stderr);
    assert.match(conflict.stderr, /WorkspaceServerVersionConflict/); assert.match(conflict.stderr, /Stop it with: concord server stop/);
    assert.equal(record(root).token, a.token); assert.equal(record(other).token, unrelated.token);
    await ok(root, ['server', 'stop']); assert.equal(existsSync(marker('0.9.1', a.pid)), false);
    await ok(root, ['server', 'start']); const b = record(root);
    assert.notEqual(b.installation, a.installation); assert.equal(existsSync(marker('0.9.2', b.pid)), true);
    for (const version of ['0.9.3', '0.9.4', '0.9.5']) { f.publish(version); f.succeed(version); }
    assert.deepEqual(readdirSync(f.root).sort(), ['0.9.1', '0.9.2', '0.9.3', '0.9.4', '0.9.5']);
    process.kill(unrelated.pid, 0); process.kill(b.pid, 0);
    f.succeed('0.9.2'); await ok(root, ['list', 'feature']);
    f.succeed('0.9.1'); assert.equal(record(other).token, unrelated.token); assert.equal(record(root).token, b.token);
    await ok(root, ['server', 'stop']); await ok(other, ['server', 'stop']);
    assert.deepEqual(readdirSync(join(f.root, '0.9.1/.in-use')), []); assert.deepEqual(readdirSync(join(f.root, '0.9.2/.in-use')), []);
  } finally {
    // Use a real installation if an assertion failed while a minimal C was active.
    f.succeed('0.9.1');
    for (const directory of [root, other]) if (existsSync(join(directory, '.git/concord/server/current.json'))) await ok(directory, ['server', 'stop']);
  }
});
