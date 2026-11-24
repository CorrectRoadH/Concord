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
  let observed = false, probed = false;
  const inspect = (...args: Parameters<typeof fs.lstatSync>) => {
    if (args[0] === path) {
      observed = true;
      if (!probed) return unlinked;
      owner.close();
    }
    if (args[0] === lock && observed) probed = true;
    return original(...args);
  };
  const mock = spyOn(fs, 'lstatSync').mockImplementation(inspect as typeof fs.lstatSync);
  try {
    const result = await runCli({ argv: ['--root', root, '--json', 'server', 'stop'], cwd: root, env: process.env });
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
