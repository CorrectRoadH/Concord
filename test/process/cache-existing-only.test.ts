import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { digest } from '../../src/model/index.js';
import { createConsumer } from '../support/consumer.js';
import { LocalRepository } from '../support/repository.js';
import { createDocument } from '../support/operations.js';
import { installedConcordCli } from '../support/support.js';

// @feature docs/feature/local-data-engine/README.md
// @issue docs/issues/exit-hang-after-output.md
test('C15 dry-run cold show returns the current source without creating a persistent cache', () => {
  const root = createConsumer();
  const repo = new LocalRepository(root);
  try { createDocument(repo, 'feature', { id: 'cold-show', title: 'Cold show', body: 'Current source.\n' }); }
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
