import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { LocalRepository, initialize } from '../dist/storage.js';
import { acquireTraceLeaseSync, releaseTraceLeaseSync, tracePrivateDirectorySync } from '../dist/coordination.js';

// @use-case docs/feature/project-onboarding/use-case/initialize-project.md
test('init preview is write-free only before owners or coordination locks exist', () => Effect.runPromise(Effect.sync(() => {
  const root = mkdtempSync(join(tmpdir(), 'concord-init-coordination-'));
  let repo: LocalRepository | undefined;
  try {
    execFileSync('git', ['init', '-q', root]);
    const traceDir = tracePrivateDirectorySync(root);
    repo = new LocalRepository(root, { initialize: true, dryRun: true });
    initialize(repo, true); repo.close(); repo = undefined;
    assert.equal(existsSync(traceDir), false);
    assert.equal(existsSync(join(root, '.git/concord')), false);
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'docs/README.md'), '# Existing owner\n');
    repo = new LocalRepository(root, { initialize: true, dryRun: true });
    assert.equal(existsSync(join(traceDir, 'publication.lock')), true);
    assert.throws(() => acquireTraceLeaseSync(root, 'exclusive', 'competing-writer', true), /busy/);
    repo.close(); repo = undefined;
    const lease = acquireTraceLeaseSync(root, 'exclusive', 'writer', true);
    try {
      assert.throws(() => new LocalRepository(root, { initialize: true, dryRun: true }), { code: 'RepositoryBusy' });
    } finally { releaseTraceLeaseSync(lease!, 'writer'); }
    for (const name of ['publication-journal.json', 'multi-file-publication-journal.json']) {
      writeFileSync(join(traceDir, name), '{}\n');
      assert.throws(() => new LocalRepository(root, { initialize: true, dryRun: true }), { code: 'RecoveryRequired' });
      rmSync(join(traceDir, name));
    }
    mkdirSync(join(root, '.git/concord'));
    writeFileSync(join(root, '.git/concord/journal.json'), JSON.stringify({ format: 'concord.journal', root, privateDir: join(root, '.git/concord'), projectId: 'pending', operation: 'init', phase: 'prepared', directories: [], changes: [], scope: { kind: 'documents', configPath: 'concord.config.ts', configSource: '', configDigest: 'sha256:pending' } }));
    assert.throws(() => new LocalRepository(root, { initialize: true, dryRun: true }), { code: 'RecoveryRequired' });
    assert.equal(existsSync(join(root, 'concord.config.ts')), false);
    rmSync(join(root, '.git/concord/journal.json'));
    execFileSync(process.execPath, [join(process.cwd(), 'dist/entry.js'), '--root', root, 'init', '--docs-only'], { encoding: 'utf8' });
    assert.equal(existsSync(join(root, 'concord.config.ts')), true);
  } finally { repo?.close(); rmSync(root, { recursive: true, force: true }); }
})));
