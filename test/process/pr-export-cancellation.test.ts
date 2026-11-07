import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { makeOwnedProcessService, observeOwnedProcessGroup } from '../../src/base/process/index.ts';
import { runCli } from '../support/cli.ts';
import { createConsumer, retainConsumer } from '../support/consumer.ts';
import { pollUntil } from '../support/support.ts';
import { tmpdir } from '../support/temporary.ts';

// @use-case docs/feature/web-workbench/use-case/review-pull-request.md
test('cancelling PR export awaits its Git process group and removes the temporary object repository', { skip: process.platform === 'win32' }, async () => {
  const root = createConsumer();
  const scratch = mkdtempSync(join(tmpdir(), 'concord-preview-cancel-'));
  const temporary = join(scratch, 'temporary');
  const shim = join(scratch, 'bin');
  const receipt = join(scratch, 'git.json');
  const controller = new AbortController();
  let running: ReturnType<typeof runCli> | undefined;
  let pid: number | undefined;
  try {
    mkdirSync(temporary);
    mkdirSync(shim);
    const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
    const resolved = await Effect.runPromise(makeOwnedProcessService().resolveExecutable(root, 'git', process.env.PATH ?? ''));
    assert.ok(resolved, 'Git is available on the test PATH');
    const executable = resolved.executable;
    git('config', 'user.name', 'Fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    writeFileSync(join(root, 'sample.md'), '# Before\n');
    git('add', '.');
    git('commit', '-qm', 'Before');
    const base = git('rev-parse', 'HEAD');
    writeFileSync(join(root, 'sample.md'), '# After\n');
    git('add', '.');
    git('commit', '-qm', 'After');
    // Only the external Git boundary is held; export owns the real temporary tree.
    writeFileSync(join(shim, 'git'), `#!${process.execPath}
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args.includes('diff')) {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  child.once('spawn', () => writeFileSync(${JSON.stringify(receipt)}, JSON.stringify({ pid: process.pid, cwd: process.cwd() })));
  setInterval(() => {}, 1000);
} else {
  const result = spawnSync(${JSON.stringify(executable)}, args, { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
  `, { mode: 0o755 });
    const before = readdirSync(temporary).sort();
    running = runCli({ argv: ['--root', root, '--json', 'view', 'export', '--base', base, '--out', join(scratch, 'output')], cwd: root,
      env: { ...process.env, PATH: `${shim}:${process.env.PATH}`, TMPDIR: temporary }, signal: controller.signal });
    const started = running.then(result => { throw new Error(`Export completed before Git readiness: ${JSON.stringify(result)}`); });
    const observed = await Promise.race([started, pollUntil(async () => {
      if (!existsSync(receipt)) return undefined;
      return Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ pid: Schema.Number, cwd: Schema.String })))(readFileSync(receipt, 'utf8'));
    }, { timeoutMs: 15000, description: 'export Git comparison readiness' })]);
    pid = observed.pid;
    assert.equal(observed.cwd.startsWith(temporary + '/concord-preview-'), true);
    assert.equal(existsSync(join(observed.cwd, 'HEAD')), true, 'Git is running in the actual temporary bare repository');
    assert.equal(observeOwnedProcessGroup(pid), 'alive');
    controller.abort();
    await assert.rejects(running);
    assert.ok(['gone', 'zombie-only'].includes(observeOwnedProcessGroup(pid)), 'cancellation awaits the actual group exit; an unreaped zombie is already exited');
    assert.deepEqual(readdirSync(temporary).sort(), before, 'interruption releases the temporary Git repository');
    assert.equal(existsSync(join(scratch, 'output')), false, 'cancelled export publishes no output');
  } finally {
    controller.abort();
    if (running !== undefined) await Promise.allSettled([running]);
    if (pid !== undefined && !['gone', 'zombie-only'].includes(observeOwnedProcessGroup(pid))) {
      retainConsumer(root);
      retainConsumer(scratch);
      throw new Error(`Export Git group ${pid} did not exit; preserved ${scratch}`);
    }
    rmSync(root, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});
