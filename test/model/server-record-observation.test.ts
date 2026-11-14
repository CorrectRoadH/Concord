import assert from 'node:assert/strict';
import test from 'node:test';
import { spyOn } from 'bun:test';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from '../support/temporary.ts';
import { readServerRecord } from '../../src/base/server-lock/index.ts';

// @feature docs/feature/local-data-engine/architecture.md#启动与裁决
test('record observation rechecks an unlinked inode but rejects hard links and bounds retries', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'concord-record-observation-'));
  const directory = join(root, 'server'), path = join(directory, 'current.json');
  fs.mkdirSync(directory);
  fs.writeFileSync(join(directory, 'lock'), '');
  const lock = fs.lstatSync(join(directory, 'lock'));
  const record = { state: 'running', pid: process.pid, startedAt: new Date().toISOString(), token: 'observed',
    lock: { device: String(lock.dev), inode: String(lock.ino) }, installation: 'current', protocol: 'current',
    socket: { path: '/unused', device: '0', inode: '0' } };
  fs.writeFileSync(path, JSON.stringify(record));
  const removed = join(directory, 'removed');
  fs.writeFileSync(removed, '');
  const fd = fs.openSync(removed, 'r');
  fs.unlinkSync(removed);
  const unlinked = fs.fstatSync(fd);
  assert.equal(unlinked.nlink, 0);
  const original = fs.lstatSync;
  try {
    for (const scenario of ['replaced', 'removed', 'unstable'] as const) {
      let calls = 0;
      const inspect = (...args: Parameters<typeof fs.lstatSync>) => {
        if (args[0] !== path) return original(...args);
        calls++;
        if (calls === 1 || scenario === 'unstable') return unlinked;
        return scenario === 'removed' ? undefined : original(...args);
      };
      const mock = spyOn(fs, 'lstatSync').mockImplementation(inspect as typeof fs.lstatSync);
      try {
        if (scenario === 'unstable') {
          assert.throws(() => readServerRecord(root, false), /bounded regular file/u);
          assert.equal(calls, 3);
        } else {
          assert.deepEqual(readServerRecord(root, false), scenario === 'removed' ? undefined : record);
          assert.equal(calls, 2);
        }
      } finally { mock.mockRestore(); }
    }
    fs.linkSync(path, join(directory, 'alias'));
    assert.throws(() => readServerRecord(root, false), /bounded regular file/u);
    fs.unlinkSync(path);
    fs.symlinkSync(join(directory, 'alias'), path);
    assert.throws(() => readServerRecord(root, false), /bounded regular file/u);
  } finally { fs.closeSync(fd); fs.rmSync(root, { recursive: true }); }
});
