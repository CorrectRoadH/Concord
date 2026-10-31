import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { beginRun, finalizeRun } from '../../src/base/publication/index.js';
import { digest } from '../../src/model/index.js';
import { LocalRepository, runApplication } from '../support/repository.js';
import { installedConcordCli } from '../support/support.js';
import { fixture } from '../support/publication-ownership-fixture.js';
const entry=installedConcordCli();


// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
// @name recovery-reports-runner-blocker
test('CLI recovery reports quarantined runner instead of claiming clean readiness', t => runApplication(Effect.sync(() => {
  const root = fixture(t);
  const repo = new LocalRepository(root);
  try {
    const run = repo.snapshot(() => beginRun(root));
    repo.snapshot(() => finalizeRun(root, run, false));
    const result = spawnSync(process.execPath, [entry, '--root', root, '--json', 'recover'], { encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const report = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ status: Schema.String })))(result.stdout);
    assert.equal(report.status, 'blocked');
    assert.ok(existsSync(join(run.lease.path, `${run.lease.owner.token}.json`)));
    const observed = spawnSync(process.execPath, [entry, '--root', root, '--json', 'list', 'memory'], { encoding: 'utf8', timeout: 15000 });
    assert.equal(observed.status, 0, observed.stderr);
    assert.throws(() => repo.publish('still-blocked', [{ path: 'memory/blocked.md', before: null, after: 'no' }]), { code: 'CleanupFailed' });
  } finally { repo.close(); }
})));


// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('recovery preserves prepared and committed journals when runner cleanup is unknown', t => runApplication(Effect.sync(() => {
  for (const phase of ['prepared', 'committed']) {
    const root = fixture(t);
    const repo = new LocalRepository(root);
    try {
      const run = repo.snapshot(() => beginRun(root));
      repo.snapshot(() => finalizeRun(root, run, false));
      const config = repo.configSnapshot;
      const journal = JSON.stringify({ format: 'concord.journal', root, privateDir: join(root, '.git/concord'), operation: 'interrupted', phase, directories: [],
        scope: { kind: 'documents', configPath: 'concord.config.ts', configSource: config.source, configDigest: config.digest },
        changes: [{ path: 'memory/interrupted.md', before: null, after: 'pending\n', beforeDigest: null, afterDigest: digest('pending\n'), mode: 420 }],
      });
      const path = join(root, '.git/concord/journal.json');
      writeFileSync(join(root, 'memory/interrupted.md'), 'pending\n');
      writeFileSync(path, journal);
      for (const args of [['recover'], ['action', '--input', '-']]) {
        const result = spawnSync(process.execPath, [entry, '--root', root, '--json', ...args], { input: JSON.stringify({ action: 'recover' }), encoding: 'utf8', timeout: 15000 });
        assert.equal(result.status, 1, result.stdout + result.stderr);
        const report = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ status: Schema.Literal('blocked'), journalStatus: Schema.Literal('pending') })))(result.stdout);
        assert.equal(report.status, 'blocked');
        assert.equal(readFileSync(path, 'utf8'), journal);
        assert.equal(readFileSync(join(root, 'memory/interrupted.md'), 'utf8'), 'pending\n');
      }
    } finally { repo.close(); }
  }
})));
