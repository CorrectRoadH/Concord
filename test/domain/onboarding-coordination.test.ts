import { initialize } from '../support/operations.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { LocalRepository } from "../support/repository.ts";

import { acquireTraceLeaseSync, releaseTraceLeaseSync, tracePrivateDirectorySync } from "../../src/base/publication/index.ts";

// @use-case docs/feature/project-onboarding/use-case/initialize-project.md
test('init preview is write-free and independent of publication owners but rejects pending journals', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-init-coordination-'));
  let repo: LocalRepository | undefined;
  try {
    execFileSync('git', ['init', '-q', root]);
    const traceDir = tracePrivateDirectorySync(root, process.env);
    repo = (await LocalRepository.open(root, { initialize: true, dryRun: true }));
    (await initialize(repo, true)); repo.close(); repo = undefined;
    assert.equal(existsSync(traceDir), false);
    assert.equal(existsSync(join(root, '.git/concord')), false);
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'docs/README.md'), '# Existing owner\n');
    repo = (await LocalRepository.open(root, { initialize: true, dryRun: true }));
    assert.equal(existsSync(join(traceDir, 'publication.lease')), false);
    assert.doesNotThrow(() => repo!.snapshot(() => {
      const concurrent = acquireTraceLeaseSync(root, 'exclusive', 'competing-writer', true, undefined, process.env)!;
      releaseTraceLeaseSync(concurrent, 'competing-writer');
    }));
    repo.close(); repo = undefined;
    const lease = acquireTraceLeaseSync(root, 'exclusive', 'writer', true, undefined, process.env);
    try {
      (await LocalRepository.open(root, { initialize: true, dryRun: true })).close();
    } finally { releaseTraceLeaseSync(lease!, 'writer'); }
    for (const name of ['publication-journal.json', 'multi-file-publication-journal.json']) {
      writeFileSync(join(traceDir, name), '{}\n');
      (await assert.rejects(async () => (await LocalRepository.open(root, { initialize: true, dryRun: true })), { code: 'RecoveryRequired' }));
      rmSync(join(traceDir, name));
    }
    mkdirSync(join(root, '.git/concord'), { recursive: true });
    writeFileSync(join(root, '.git/concord/journal.json'), JSON.stringify({ format: 'concord.journal', root, privateDir: join(root, '.git/concord'), operation: 'init', phase: 'prepared', directories: [], changes: [], scope: { kind: 'documents', configPath: 'concord.config.ts', configSource: '', configDigest: 'sha256:pending' } }));
    (await assert.rejects(async () => (await LocalRepository.open(root, { initialize: true, dryRun: true })), { code: 'RecoveryRequired' }));
    assert.equal(existsSync(join(root, 'concord.config.ts')), false);
    rmSync(join(root, '.git/concord/journal.json'));
    repo = (await LocalRepository.open(root, { initialize: true })); (await initialize(repo, false, { testRoots: [] })); repo.close(); repo = undefined;
    assert.equal(existsSync(join(root, 'concord.config.ts')), true);
  } finally { repo?.close(); rmSync(root, { recursive: true, force: true }); }
})));
