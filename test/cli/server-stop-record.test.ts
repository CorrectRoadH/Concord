import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { spyOn } from 'bun:test';
import { acquireFileLock } from '../../src/base/file-lock/index.ts';
import { runCli } from '../support/cli.ts';
import { createConsumer } from '../support/consumer.ts';

// @spec docs/feature/local-data-engine/architecture.md#启动与裁决
test('server stop reobserves an unlinked record while the owner releases its lock', async () => {
  const root = await createConsumer();
  const directory = join(root, '.git/concord/server');
  fs.mkdirSync(directory, { recursive: true });
  const lock = join(directory, 'lock'), path = join(directory, 'current.json');
  const owner = acquireFileLock(lock);
  const fd = fs.openSync(path, 'wx', 0o600);
  fs.unlinkSync(path);
  const unlinked = fs.fstatSync(fd);
  const original = fs.lstatSync;
  let observations = 0, probed = false, releasing = false;
  const inspect = (...args: Parameters<typeof fs.lstatSync>) => {
    if (args[0] === path) {
      observations++;
      if (!releasing || !probed) return unlinked;
      owner.close();
    }
    if (args[0] === lock && observations > 0) probed = true;
    return original(...args);
  };
  const mock = spyOn(fs, 'lstatSync').mockImplementation(inspect as typeof fs.lstatSync);
  try {
    const stop = () => runCli({ argv: ['--root', root, '--json', 'server', 'stop'], cwd: root, env: process.env });
    const held = await stop();
    assert.equal(held.exitCode, 1, held.stdout + held.stderr);
    assert.deepEqual(JSON.parse(held.stdout || held.stderr), { ok: false, error: 'WorkspaceServerUnavailable',
      message: 'Server record must be a bounded regular file', details: { mode: unlinked.mode, links: 0, bytes: unlinked.size } });
    assert.equal(observations, 3);
    owner.verify();

    observations = 0;
    probed = false;
    releasing = true;
    const result = await stop();
    assert.ok(probed, 'the client checked the native lock after observing the unlinked record');
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    assert.equal(fs.existsSync(path), false);
  } finally {
    mock.mockRestore();
    owner.close();
    fs.closeSync(fd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
