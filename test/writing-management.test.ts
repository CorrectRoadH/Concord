import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { initialize, LocalRepository } from '../dist/storage.js';
import { digest } from '../dist/shared.js';
import { showWriting, setWriting } from '../dist/writing-management.js';
import { checkWriting } from '../dist/writing.js';

const policyPath = 'docs/concord-writing.json';
const policy = { format: 'concord.writing/v2' as const, roots: ['docs'] as [string, ...string[]], bannedTerms: [{ term: 'Resolve', use: '修复', why: '统一写法' }] };
const source = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-writing-management-'));
  execFileSync('git', ['init', '-q', root]);
  const repo = new LocalRepository(root, { initialize: true });
  try { initialize(repo, false, { testRoots: [] }); } finally { repo.close(); }
  return root;
};
const withRepo = <T>(root: string, run: (repo: LocalRepository) => T, options = {}) => {
  const repo = new LocalRepository(root, options);
  try { return run(repo); } finally { repo.close(); }
};
const write = (root: string, path: string, body: string) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), body); };

// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
test('writing show preserves invalid and v1 bytes for explicit CAS repair', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture();
  try {
    assert.equal(withRepo(root, showWriting).state, 'missing');
    write(root, policyPath, source({ ...policy, format: 'concord.writing/v1' }));
    const old = withRepo(root, showWriting);
    assert.equal(old.state, 'invalid');
    assert.throws(() => withRepo(root, checkWriting), { code: 'WritingMigrationRequired' });
    assert.throws(() => withRepo(root, repo => setWriting(repo, policy, null)), { code: 'PreimageChanged' });
    const saved = withRepo(root, repo => setWriting(repo, policy, old.digest));
    assert.equal(saved.digest, digest(saved.source));
    assert.equal(withRepo(root, showWriting).state, 'valid');
    assert.throws(() => withRepo(root, repo => setWriting(repo, { ...policy, bannedTerms: [...policy.bannedTerms, { term: 'resolve', use: '修', why: '重复' }] }, saved.digest)), { code: 'InvalidWritingPolicy' });
    assert.throws(() => withRepo(root, repo => setWriting(repo, { ...policy, roots: ['../escape'] }, saved.digest)), { code: 'InvalidWritingPolicy' });
    rmSync(join(root, policyPath));
    symlinkSync('concepts.json', join(root, policyPath));
    assert.throws(() => withRepo(root, showWriting), { code: 'UnsafePath' });
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
test('policy journal uses two-way authorization and preserves conflicting recovery scenes', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture(), journalPath = join(root, '.git/concord/journal.json');
  try {
    const before = '{ broken', after = source(policy);
    write(root, policyPath, before);
    const config = readFileSync(join(root, 'concord.config.ts'), 'utf8');
    const projectId = withRepo(root, repo => repo.config.projectId);
    const base = { format: 'concord.journal', root, privateDir: join(root, '.git/concord'), projectId, operation: 'set-writing-policy', phase: 'prepared', directories: [], scope: { kind: 'documents', configPath: 'concord.config.ts', configSource: config, configDigest: digest(config) }, changes: [{ path: policyPath, before, after, beforeDigest: digest(before), afterDigest: digest(after), mode: 0o644 }] };
    for (const forged of [
      { ...base, operation: 'set-markdown' },
      { ...base, changes: [{ ...base.changes[0], path: 'docs/other.json' }] },
      { ...base, changes: [{ ...base.changes[0], after: null, afterDigest: null }] },
      { ...base, changes: [{ ...base.changes[0], after: '{}', afterDigest: digest('{}') }] },
    ]) {
      writeFileSync(journalPath, source(forged));
      assert.throws(() => new LocalRepository(root, { recover: true }), { code: 'RecoveryConflict' });
      assert.equal(readFileSync(join(root, policyPath), 'utf8'), before);
      rmSync(journalPath);
    }
    writeFileSync(journalPath, source(base));
    write(root, policyPath, after);
    assert.equal(withRepo(root, repo => repo.recover(), { recover: true }).status, 'rolled-back');
    assert.equal(readFileSync(join(root, policyPath), 'utf8'), before);
    write(root, policyPath, after);
    writeFileSync(journalPath, source({ ...base, phase: 'committed' }));
    assert.equal(withRepo(root, repo => repo.recover(), { recover: true }).status, 'committed');
    assert.equal(readFileSync(join(root, policyPath), 'utf8'), after);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
test('public CLI writing action validates strict v2 and creation CAS', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture(), cli = join(process.cwd(), 'dist/entry.js'), input = join(root, 'writing-action.json');
  try {
    writeFileSync(input, JSON.stringify({ action: 'writing.set', policy, expectedDigest: null }));
    const created = spawnSync(process.execPath, [cli, '--root', root, '--json', 'action', '--input', input], { encoding: 'utf8', timeout: 15_000 });
    assert.equal(created.status, 0, created.stderr);
    assert.equal(JSON.parse(readFileSync(join(root, policyPath), 'utf8')).format, 'concord.writing/v2');
    const conflict = spawnSync(process.execPath, [cli, '--root', root, '--json', 'action', '--input', input], { encoding: 'utf8', timeout: 15_000 });
    assert.notEqual(conflict.status, 0);
    assert.match(`${conflict.stdout}${conflict.stderr}`, /PreimageChanged/);
    assert.equal(existsSync(join(root, 'docs/concepts.json')), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));
