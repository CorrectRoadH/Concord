import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { snapshot } from '../dist/config.js';
import { LocalRepository, initialize } from '../dist/storage.js';
import { digest } from '../dist/shared.js';

const cli = resolve('dist/entry.js');
const fixture = (body: (root: string) => void) => {
  const root = mkdtempSync(join(tmpdir(), 'concord-ts-only-'));
  try { execFileSync('git', ['init', '-q', root]); body(root); }
  finally { rmSync(root, { recursive: true, force: true }); }
};

// @use-case docs/feature/project-onboarding/use-case/maintain-project-config.md
test('JSON-only and dual-config projects require migration without interpreting old bytes', () => Effect.runPromise(Effect.sync(() => fixture(root => {
  const source = '{ deliberately invalid old configuration }\n';
  writeFileSync(join(root, 'concord.json'), source);
  mkdirSync(join(root, 'child'));
  for (const args of [['doctor'], ['init'], ['recover']] as const) {
    const result = spawnSync(process.execPath, [cli, '--root', root, '--json', ...args], { encoding: 'utf8', timeout: 20_000 });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /ProjectMigrationRequired/);
  }
  const nested = spawnSync(process.execPath, [cli, '--json', 'doctor'], { cwd: join(root, 'child'), encoding: 'utf8', timeout: 20_000 });
  assert.match(nested.stderr, /ProjectMigrationRequired/);
  const workspace = execFileSync(process.execPath, [cli, '--root', root, '--json', 'workspace', 'show'], { encoding: 'utf8', timeout: 20_000 });
  assert.match(workspace, /ProjectMigrationRequired/);
  assert.doesNotMatch(workspace, /deliberately invalid/);
  assert.match(workspace, /"project":null/);
  assert.equal(existsSync(join(root, '.git/concord')), false);
  assert.equal(existsSync(join(root, '.git/niceeval')), false);
  writeFileSync(join(root, 'concord.config.ts'), 'export default {};\n');
  assert.throws(() => new LocalRepository(root), { code: 'ProjectMigrationRequired' });
  assert.equal(readFileSync(join(root, 'concord.json'), 'utf8'), source);
  assert.throws(() => Reflect.apply(snapshot, undefined, ['concord.json', source]), { code: 'ProjectMigrationRequired' });
}))));

// @use-case docs/feature/project-onboarding/use-case/maintain-project-config.md
test('old journals are refused before stale locks or interrupted files can be changed', () => Effect.runPromise(Effect.sync(() => fixture(root => {
  const initial = new LocalRepository(root, { initialize: true });
  initialize(initial); const config = initial.configSnapshot; initial.close();
  const privateDir = join(root, '.git/concord');
  const journalPath = join(privateDir, 'journal.json');
  const lockPath = join(privateDir, 'lock.json');
  const path = 'memory/interrupted.md';
  writeFileSync(join(root, path), '# Interrupted\n');
  const publicationLock = join(root, '.git/concord/trace/publication.lock');
  writeFileSync(publicationLock, '');
  chmodSync(publicationLock, 0o644);
  for (const [scope, code] of [
    [{ kind: 'documents' }, 'JournalMigrationRequired'],
    [{ kind: 'source', configSource: '{}', configDigest: digest('{}') }, 'JournalMigrationRequired'],
    [{ kind: 'source', configSource: config.source, configDigest: digest(config.source) }, 'InvalidData'],
    [{ kind: 'source', configSource: '{}', configDigest: 'tampered' }, 'InvalidData'],
    [{ kind: 'documents', configPath: 'concord.json', configSource: '{}', configDigest: digest('{}') }, 'JournalMigrationRequired'],
    [{ kind: 'documents', configPath: 'concord.config.ts', configSource: config.source }, 'InvalidData'],
  ] as const) {
    const journal = JSON.stringify({ format: 'concord.journal', root, privateDir, projectId: config.config.projectId, operation: 'old-publication', phase: 'prepared', directories: [], scope, changes: [{ path, before: '# Before\n', after: '# Interrupted\n', beforeDigest: digest('# Before\n'), afterDigest: digest('# Interrupted\n'), mode: 420 }] });
    const lock = JSON.stringify({ format: 'concord.lock/v1', root, host: hostname(), pid: 2147483647, token: 'offline-recovery-only' });
    writeFileSync(journalPath, journal); writeFileSync(lockPath, lock);
    for (const options of [{ dryRun: true }, { recover: true }]) assert.throws(() => new LocalRepository(root, options), { code });
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
}))));
