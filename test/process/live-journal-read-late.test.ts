// 跨进程保证：只读快照验证时遇到正在发布的 journal，丢弃旧观察并在发布结束后重读；不重放写入。
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { Sources } from '../../src/base/sources/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { LocalRepository, runApplication } from '../support/repository.ts';

// @feature docs/feature/local-sdlc/architecture.md#写入管线
// @issue docs/issues/live-journal-read-recovery.md
test('a read snapshot encountering a live journal during verification rereads after publication', { timeout: 20_000 }, async () => {
  const root = createConsumer();
  const document = join(root, 'docs/feature/live/README.md');
  fs.mkdirSync(join(root, 'docs/feature/live'), { recursive: true });
  fs.writeFileSync(document, '# Before publication\n');
  const repo = new LocalRepository(root, { access: 'read', persistentCache: 'off' });
  let writer: ChildProcess | undefined;
  let exited: Promise<unknown[]> | undefined;
  let diagnostics = '';
  const original = fs.lstatSync;
  let releaseScheduled = false;
  let attempts = 0;
  try {
    Object.assign(fs, { lstatSync: ((...args: Parameters<typeof fs.lstatSync>) => {
      const result = original(...args);
      if (args[0] === join(root, '.git/concord/journal.json') && result !== undefined && !releaseScheduled) {
        releaseScheduled = true;
        setImmediate(() => { if (writer?.stdin?.writable) writer.stdin.end('1'); });
      }
      return result;
    }) as typeof fs.lstatSync });
    syncBuiltinESMExports();
    const value = await runApplication(Effect.flatMap(Sources, sources => sources.snapshot(repo, Effect.promise(async () => {
      attempts++;
      const observed = repo.read('docs/feature/live/README.md');
      if (attempts === 1) {
        writer = spawn(process.execPath, ['--conditions=concord-source', '--input-type=module', '-e', `
          import fs from 'node:fs';
          import { syncBuiltinESMExports } from 'node:module';
          import { LocalRepository } from './test/support/repository.ts';
          const root = process.argv[1];
          const repo = new LocalRepository(root, { optimistic: true, persistentCache: 'off' });
          const rename = fs.renameSync;
          let paused = false;
          fs.renameSync = (from, to) => {
            rename(from, to);
            if (!paused && to === root + '/.git/concord/journal.json') {
              paused = true; console.log('journal-prepared');
              fs.readSync(0, Buffer.alloc(1), 0, 1, null);
            }
          };
          syncBuiltinESMExports();
          try { repo.publish('live-read', [{ path: 'docs/feature/live/README.md', before: repo.read('docs/feature/live/README.md'), after: '# Published architecture\\n' }]); }
          finally { repo.close(); }
        `, root], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] });
        exited = once(writer, 'exit');
        writer.stderr!.on('data', bytes => { diagnostics += String(bytes); });
        await new Promise<void>((accept, reject) => {
          let output = '';
          writer!.stdout!.on('data', bytes => { output += String(bytes); if (output.includes('journal-prepared\n')) accept(); });
          writer!.once('exit', () => reject(new Error(`writer exited before journal: ${diagnostics}`)));
          writer!.once('error', reject);
        });
      }
      return observed;
    }))));
    assert.equal(value, '# Published architecture\n');
    assert.equal(attempts, 2, 'only read-only work is repeated after discarding the pre-publication observation');
    assert.equal((await exited!)[0], 0, diagnostics);
  } finally {
    Object.assign(fs, { lstatSync: original });
    syncBuiltinESMExports();
    if (writer?.stdin?.writable) writer.stdin.end('1');
    if (exited) await exited;
    repo.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
