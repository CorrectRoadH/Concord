import assert from 'node:assert/strict';
import test from 'node:test';
import fs, { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { moveDocument, planDocumentMove } from '../../src/app/index.ts';
import { LocalRepository, runApplication } from '../support/repository.ts';
import { syncBuiltinMocks } from '../support/builtin-mocks.ts';
import { moveFixture, source, target, write } from '../support/document-move.ts';

async function interrupt(root: string, repo: LocalRepository, phase: 'prepared' | 'committed', packageMove = true) {
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    const path = String(to);
    const stop = phase === 'committed' ? path.endsWith('/concord/journal.json') && /"phase":"committed"/u.test(readFileSync(from, 'utf8')) : path.startsWith(`${root}/docs/engineering/renamed/assets/`);
    rename(from, to);
    if (stop) throw new Error('Interrupted document move');
  };
  syncBuiltinMocks();
  try { await assert.rejects(() => runApplication(moveDocument(repo, packageMove ? 'docs/feature/a' : source, packageMove ? 'docs/engineering/renamed' : target)), { code: 'RecoveryRequired' }); }
  finally { fs.renameSync = rename; syncBuiltinMocks(); }
}

// @use-case docs/feature/local-sdlc/use-case/move-spec-documents.md#rename-package
test('move recovery reconstructs frozen membership and binary images after partial or committed publication', async () => {
  for (const phase of ['prepared', 'committed'] as const) await moveFixture(async (root, repo) => {
    const original = readFileSync(join(root, 'docs/feature/a/assets/picture.bin'));
    await interrupt(root, repo, phase);
    repo.close();
    const recovery = await LocalRepository.open(root, { recover: true, optimistic: true, persistentCache: 'off' });
    try { assert.equal((await recovery.recover()).status, phase === 'prepared' ? 'rolled-back' : 'committed'); }
    finally { recovery.close(); }
    const prefix = phase === 'prepared' ? 'docs/feature/a' : 'docs/engineering/renamed';
    assert.deepEqual(readFileSync(join(root, `${prefix}/assets/picture.bin`)), original);
    assert.equal(existsSync(join(root, phase === 'prepared' ? 'docs/engineering/renamed' : 'docs/feature/a')), false);
    assert.equal(existsSync(join(repo.privateDir, 'journal.json')), false);
  });
});

// @use-case docs/feature/local-sdlc/use-case/move-spec-documents.md#apply
test('recovery refuses a forged move image, new scan member or external edit and retains the journal', async t => {
  for (const scenario of ['forged image', 'new source member', 'new test member', 'external edit'] as const) await t.test(scenario, async () => moveFixture(async (root, repo) => {
    await interrupt(root, repo, 'committed');
    const journalPath = join(repo.privateDir, 'journal.json');
    if (scenario === 'forged image') {
      const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
      journal.changes.find((change: { path: string }) => change.path === 'src/one.ts').after += '// Forged\n';
      write(root, '.git/concord/journal.json', JSON.stringify(journal));
    } else if (scenario === 'new source member') write(root, 'src/new.ts', 'export const added = true;\n');
    else if (scenario === 'new test member') write(root, 'test/new.ts', `// @use-case ${source}#run\n`);
    else write(root, 'src/one.ts', '// External edit\n');
    repo.close();
    await assert.rejects(async () => {
      const recovery = await LocalRepository.open(root, { recover: true, optimistic: true, persistentCache: 'off' });
      try { await recovery.recover(); } finally { recovery.close(); }
    }, { code: 'RecoveryConflict' });
    assert.equal(existsSync(journalPath), true);
  }));
});

// @use-case docs/feature/local-sdlc/use-case/move-spec-documents.md#check
test('authorization rejects writes outside the recomputed move set before a journal is created', async () => moveFixture(async (root, repo) => {
  await assert.rejects(() => repo.snapshot(async () => {
    const plan = await planDocumentMove(repo, { from: source, to: target });
    await repo.publishDocumentMove({ ...plan, changes: [...plan.changes, { path: 'notes.txt', before: readFileSync(join(root, 'notes.txt'), 'utf8'), after: 'Unauthorized\n' }] });
  }), { code: 'FileChangedSinceRead' });
  assert.equal(existsSync(join(repo.privateDir, 'journal.json')), false);
  assert.equal(existsSync(join(root, source)), true);
}));
