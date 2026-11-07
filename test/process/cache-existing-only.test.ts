// 跨进程保证：进程终止与信号——真实dry-run冷show在输出后退出且不创建持久缓存或锁文件。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { digest } from '../../src/model/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { LocalRepository } from '../support/repository.ts';
import { createDocument } from '../support/operations.ts';
import { installedConcordCli } from '../support/support.ts';

// @feature docs/feature/local-data-engine/README.md
// @issue docs/issues/exit-hang-after-output.md
test('C15 dry-run cold show returns the current source without creating a persistent cache', async () => {
  const root = (await createConsumer());
  const repo = (await LocalRepository.open(root));
  try { (await createDocument(repo, 'feature', { id: 'cold-show', title: 'Cold show', body: 'Current source.\n' })); }
  finally { repo.close(); }
  const path = 'docs/feature/cold-show/README.md', database = join(root, '.git/concord/cache.hawdb');
  try {
    assert.equal(existsSync(database), false);
    const shown = spawnSync(process.execPath, [installedConcordCli(), '--root', root, '--json', '--dry-run', 'show', 'cold-show'], { encoding: 'utf8', timeout: 15_000 });
    assert.equal(shown.status, 0, shown.stdout + shown.stderr);
    const value = JSON.parse(shown.stdout) as { operation: string; document: { path: string; digest: string } };
    assert.equal(value.operation, 'show');
    assert.equal(value.document.path, path);
    assert.equal(value.document.digest, digest(readFileSync(join(root, path), 'utf8')));
    assert.equal(existsSync(database), false, 'only a workspace service or explicit cache rebuild may create the persistent database');
    assert.equal(existsSync(`${database}.concord.lock`), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
