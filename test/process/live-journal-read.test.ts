// 跨进程保证：真实发布者持租约并写完 journal 后，读取等待发布结束而不是要求恢复。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { createConsumer } from '../support/consumer.ts';
import { runCli } from '../support/cli.ts';

// @feature docs/feature/local-sdlc/architecture.md#写入管线
// @issue docs/issues/live-journal-read-recovery.md
test('a current read waits for a live journal publisher and observes its completed publication', { timeout: 20_000 }, async () => {
  const root = createConsumer();
  const document = join(root, 'docs/feature/live/README.md');
  fs.mkdirSync(join(root, 'docs/feature/live'), { recursive: true });
  fs.writeFileSync(document, '# Before publication\n');
  const journal = join(root, '.git/concord/journal.json');
  const writer = spawn(process.execPath, ['--conditions=concord-source', '--input-type=module', '-e', `
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
        paused = true;
        console.log('journal-prepared');
        fs.readSync(0, Buffer.alloc(1), 0, 1, null);
      }
    };
    syncBuiltinESMExports();
    try { repo.publish('live-read', [{ path: 'docs/feature/live/README.md', before: repo.read('docs/feature/live/README.md'), after: '# Published architecture\\n' }]); }
    finally { repo.close(); }
  `, root], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = once(writer, 'exit');
  let diagnostics = '';
  writer.stderr.on('data', bytes => { diagnostics += String(bytes); });
  let reading: ReturnType<typeof runCli> | undefined;
  const original = fs.lstatSync;
  try {
    await new Promise<void>((accept, reject) => {
      let output = '';
      writer.stdout.on('data', bytes => { output += String(bytes); if (output.includes('journal-prepared\n')) accept(); });
      writer.once('exit', () => reject(new Error(`writer exited before journal: ${diagnostics}`)));
      writer.once('error', reject);
    });
    let observed!: () => void;
    const journalObserved = new Promise<void>(accept => { observed = accept; });
    Object.assign(fs, { lstatSync: ((...args: Parameters<typeof fs.lstatSync>) => {
      const result = original(...args);
      if (args[0] === journal) observed();
      return result;
    }) as typeof fs.lstatSync });
    syncBuiltinESMExports();
    let settled = false;
    reading = runCli({ cwd: root, argv: ['--root', root, '--json', '--dry-run', 'list', 'feature'], env: process.env });
    void reading.then(() => { settled = true; }, () => { settled = true; });
    await journalObserved;
    await new Promise<void>(accept => setImmediate(accept));
    if (settled) assert.match((await reading).stderr, /RecoveryRequired/);
    assert.equal(settled, false, 'a live journal must wait rather than return RecoveryRequired');
    writer.stdin.write('1');
    const [code] = await exited;
    assert.equal(code, 0, diagnostics);
    const reply = await reading;
    assert.equal(reply.exitCode, 0, reply.stderr);
    assert.match(reply.stdout, /Published architecture/);
    assert.equal(fs.readFileSync(document, 'utf8'), '# Published architecture\n');
  } finally {
    Object.assign(fs, { lstatSync: original });
    syncBuiltinESMExports();
    if (writer.exitCode === null && writer.signalCode === null) writer.stdin.end('1');
    await exited;
    await reading;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
