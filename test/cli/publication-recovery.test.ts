import assert from 'node:assert/strict';
import { runCli } from '../support/cli.ts';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { beginRun, finalizeRun } from '../../src/base/publication/index.ts';
import { digest } from '../../src/model/index.ts';
import { LocalRepository, runApplication } from '../support/repository.ts';
import '../support/support.ts';
import { fixture } from '../support/publication-ownership-fixture.ts';


// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
// @name recovery-reports-observation-blocker
test('CLI recovery reports quarantined observation while permitting publication', t => runApplication(Effect.promise(async () => {
  const root = (await fixture(t));
  const repo = (await LocalRepository.open(root));
  try {
    const run = repo.snapshot(() => beginRun(root, process.env));
    repo.snapshot(() => finalizeRun(root, run, false, process.env));
    const result = await runCli({ argv: ['--root', root, '--json', 'recover'], cwd: process.cwd(), env: process.env, stdin: '', signal: AbortSignal.timeout(15000) });
    assert.equal(result.exitCode, 1, result.stdout + result.stderr);
    const report = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ status: Schema.String, journalStatus: Schema.String, observationSlot: Schema.Struct({ status: Schema.String, code: Schema.String }) })))(result.stdout);
    assert.equal(report.status, 'blocked');
    assert.equal(report.journalStatus, 'clean');
    assert.equal(report.observationSlot.status, 'blocked');
    assert.equal(report.observationSlot.code, 'CleanupFailed');
    assert.ok(existsSync(join(run.lease.path, `${run.lease.owner.token}.json`)));
    const observed = await runCli({ argv: ['--root', root, '--json', 'list', 'memory'], cwd: process.cwd(), env: process.env, stdin: '', signal: AbortSignal.timeout(15000) });
    assert.equal(observed.exitCode, 0, observed.stderr);
    await repo.publish('after-quarantine', [{ path: 'memory/available.md', before: null, after: '# Available\n' }]);
    assert.equal(readFileSync(join(root, 'memory/available.md'), 'utf8'), '# Available\n');
    assert.throws(() => repo.snapshot(() => beginRun(root, process.env)), { code: 'RepositoryBusy' }, 'unknown cleanup still blocks the next external observation');
    assert.ok(existsSync(join(run.lease.path, `${run.lease.owner.token}.json`)), 'publication cannot reclaim uncertain observation ownership');
  } finally { repo.close(); }
})));


// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('recovery handles prepared and committed journals while observation cleanup is unknown', t => runApplication(Effect.promise(async () => {
  for (const phase of ['prepared', 'committed']) {
    const root = (await fixture(t));
    const repo = (await LocalRepository.open(root));
    try {
      const run = repo.snapshot(() => beginRun(root, process.env));
      repo.snapshot(() => finalizeRun(root, run, false, process.env));
      const config = repo.configSnapshot;
      const journal = JSON.stringify({ format: 'concord.journal', root, privateDir: join(root, '.git/concord'), operation: 'interrupted', phase, directories: [],
        scope: { kind: 'documents', configPath: 'concord.config.ts', configSource: config.source, configDigest: config.digest },
        changes: [{ path: 'memory/interrupted.md', before: null, after: 'pending\n', beforeDigest: null, afterDigest: digest('pending\n'), mode: 420 }],
      });
      const path = join(root, '.git/concord/journal.json');
      for (const args of [['recover'], ['action', '--input', '-']]) {
        writeFileSync(join(root, 'memory/interrupted.md'), 'pending\n');
        writeFileSync(path, journal);
        const result = await runCli({ argv: ['--root', root, '--json', ...args], cwd: process.cwd(), env: process.env, stdin: JSON.stringify({ action: 'recover' }), signal: AbortSignal.timeout(15000) });
        assert.equal(result.exitCode, 1, result.stdout + result.stderr);
        const report = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ status: Schema.Literal('blocked'), journalStatus: Schema.String, observationSlot: Schema.Struct({ status: Schema.Literal('blocked') }) })))(result.stdout);
        assert.equal(report.status, 'blocked');
        assert.equal(report.journalStatus, phase === 'prepared' ? 'rolled-back' : 'committed');
        assert.equal(existsSync(path), false, 'observation cleanup does not prevent journal recovery');
        if (phase === 'committed') assert.equal(readFileSync(join(root, 'memory/interrupted.md'), 'utf8'), 'pending\n');
        else assert.equal(existsSync(join(root, 'memory/interrupted.md')), false, 'prepared publication rolls back to its absent preimage');
        assert.ok(existsSync(join(run.lease.path, `${run.lease.owner.token}.json`)), 'journal recovery preserves observation ownership');
      }
    } finally { repo.close(); }
  }
})));
