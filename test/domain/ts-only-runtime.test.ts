import { initialize } from '../support/operations.ts';
import { executeQuery, recoverLocalState } from '../../src/app/index.ts';
import { runApplication } from '../support/repository.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { tmpdir } from '../support/temporary.ts';
import { join } from 'node:path';
import test from 'node:test';
import { snapshot } from "../../src/base/workspace/index.ts";
import { LocalRepository } from "../support/repository.ts";

import { digest } from "../../src/model/index.ts";

const fixture = async (body: (root: string) => unknown) => {
  const root = mkdtempSync(join(tmpdir(), 'concord-ts-only-'));
  try { execFileSync('git', ['init', '-q', root]); await body(root); }
  finally { rmSync(root, { recursive: true, force: true }); }
};

// @use-case docs/feature/project-onboarding/use-case/maintain-project-config.md
test('warm configuration parsing preserves caller isolation and rejects changed source bytes', () => fixture(async root => {
  const initial = new LocalRepository(root, { initialize: true });
  try { initialize(initial, false, { testRoots: ['test', 'tests'] }); } finally { initial.close(); }
  const source = readFileSync(join(root, 'concord.config.ts'), 'utf8');
  const first = snapshot('concord.config.ts', source);
  const expected = [...(first.config.testRoots ?? [])];
  (first.config.testRoots as string[]).push('caller-only');
  assert.deepEqual(snapshot('concord.config.ts', source).config.testRoots, expected);
  assert.throws(() => snapshot('concord.config.ts', source.replace('testRoots', 'testRootz')), { code: 'InvalidData' });
  assert.deepEqual(snapshot('concord.config.ts', source).config.testRoots, expected);
}));

// @use-case docs/feature/project-onboarding/use-case/maintain-project-config.md
test('only the current TS config is read and unrelated files remain untouched', () => fixture(async root => {
  const source = '{ deliberately invalid unrelated bytes }\n';
  writeFileSync(join(root, 'concord.json'), source);
  const result = await runApplication(executeQuery(root, { name: 'config.show', input: {} }, 'off'));
  assert.equal(result.exitCode, 0);
  assert.equal(existsSync(join(root, 'concord.config.ts')), false);
  const initial = new LocalRepository(root, { initialize: true });
  try { initialize(initial, false, { testRoots: ['test', 'tests'] }); } finally { initial.close(); }
  const checked = await runApplication(executeQuery(root, { name: 'check', input: {} }, 'off'));
  assert.equal(checked.exitCode, 0);
  assert.equal(readFileSync(join(root, 'concord.json'), 'utf8'), source);
  assert.throws(() => Reflect.apply(snapshot, undefined, ['concord.json', source]), { code: 'InvalidData' });
}));

// @use-case docs/feature/project-onboarding/use-case/maintain-project-config.md
test('old journals are refused before stale locks or interrupted files can be changed', () => fixture(async root => {
  const initial = new LocalRepository(root, { initialize: true });
  initialize(initial, false, { testRoots: ['test', 'tests'] }); const config = initial.configSnapshot; initial.close();
  const privateDir = join(root, '.git/concord');
  const journalPath = join(privateDir, 'journal.json');
  const lockPath = join(privateDir, 'lock.json');
  const path = 'memory/interrupted.md';
  writeFileSync(join(root, path), '# Interrupted\n');
  const publicationLock = join(root, '.git/concord/trace/publication.lock');
  writeFileSync(publicationLock, '');
  chmodSync(publicationLock, 0o644);
  for (const [scope, code] of [
    [{ kind: 'documents' }, 'InvalidData'],
    [{ kind: 'source', configSource: '{}', configDigest: digest('{}') }, 'InvalidData'],
    [{ kind: 'source', configSource: config.source, configDigest: digest(config.source) }, 'InvalidData'],
    [{ kind: 'source', configSource: '{}', configDigest: 'tampered' }, 'InvalidData'],
    [{ kind: 'documents', configPath: 'concord.json', configSource: '{}', configDigest: digest('{}') }, 'InvalidData'],
    [{ kind: 'documents', configPath: 'concord.config.ts', configSource: config.source }, 'InvalidData'],
  ] as const) {
    const journal = JSON.stringify({ format: 'concord.journal', root, privateDir, operation: 'old-publication', phase: 'prepared', directories: [], scope, changes: [{ path, before: '# Before\n', after: '# Interrupted\n', beforeDigest: digest('# Before\n'), afterDigest: digest('# Interrupted\n'), mode: 420 }] });
    const lock = JSON.stringify({ format: 'concord.lock/v1', root, host: hostname(), pid: 2147483647, token: 'offline-recovery-only' });
    writeFileSync(journalPath, journal); writeFileSync(lockPath, lock);
    for (const options of [{ dryRun: true }, { recover: true }]) assert.throws(() => new LocalRepository(root, options), { code });
    for (const args of [['check'], ['recover']] as const) {
      if (args[0] === 'recover') await assert.rejects(runApplication(recoverLocalState(root)), { code: 'InvalidData' });
      else await assert.rejects(runApplication(executeQuery(root, { name: 'check', input: {} }, 'off')), { code: 'InvalidData' });
    }
    assert.equal(readFileSync(journalPath, 'utf8'), journal);
    assert.equal(readFileSync(lockPath, 'utf8'), lock);
    assert.equal(readFileSync(join(root, path), 'utf8'), '# Interrupted\n');
    assert.equal(statSync(publicationLock).mode & 0o777, 0o644);
    rmSync(journalPath); rmSync(lockPath);
  }
  const repo = new LocalRepository(root);
  try {
    assert.throws(() => repo.publish('old-config', [{ path: 'concord.json', before: null, after: '{}' }]), { code: 'InvalidChange' });
    assert.equal(existsSync(join(root, 'concord.json')), false);
    assert.throws(() => repo.publish('remove-config', [{ path: 'concord.config.ts', before: config.source, after: null }]), { code: 'InvalidChange' });
  } finally { repo.close(); }
}));

