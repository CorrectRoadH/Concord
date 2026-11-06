import { createConsumer } from '../support/consumer.ts';
import { writeProjectConfig } from '../support/support.ts';
import { writeWritingFile } from '../support/writing-files.ts';
import { initialize } from '../support/operations.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { join } from 'node:path';
import test from 'node:test';
import { LocalRepository } from '../support/repository.ts';
import { digest, parseWritingPolicy, renderWritingPolicy } from '../../src/model/index.ts';
import { showWriting, checkWriting } from '../../src/domain/writing/index.ts';

// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
test('ordinary Markdown saves create, repair and compare writing file preimages', () => {
  const root = createConsumer();
  writeProjectConfig(root, { testRoots: [] });
  const path = 'docs/writing.md';
  const policy = { bannedTerms: [{ term: 'Resolve', use: '修复', why: '统一写法' }] };
  const withRepo = <T>(run: (repo: LocalRepository) => T) => { const repo = new LocalRepository(root); try { return run(repo); } finally { repo.close(); } };
  try {
    rmSync(join(root, path));
    assert.equal(withRepo(showWriting).state, 'missing');
    withRepo(repo => writeWritingFile(repo, policy, null, true));
    assert.equal(withRepo(showWriting).state, 'missing');
    const created = withRepo(repo => writeWritingFile(repo, policy, null));
    assert.deepEqual(parseWritingPolicy(readFileSync(join(root, path), 'utf8')), policy);
    assert.throws(() => withRepo(repo => writeWritingFile(repo, policy, null)), { code: 'FileChangedSinceRead' });
    const invalid = '# Rules\n\n## Not a rules section\n';
    writeFileSync(join(root, path), invalid);
    const shown = withRepo(showWriting);
    assert.equal(shown.state, 'invalid'); assert.equal(shown.source, invalid);
    assert.throws(() => withRepo(checkWriting), { code: 'InvalidWritingPolicy' });
    assert.throws(() => withRepo(repo => writeWritingFile(repo, policy, created.digest)), { code: 'FileChangedSinceRead' });
    withRepo(repo => writeWritingFile(repo, policy, digest(invalid)));
    assert.equal(readFileSync(join(root, path), 'utf8'), renderWritingPolicy(policy));
    rmSync(join(root, path)); symlinkSync('concepts.md', join(root, path));
    assert.throws(() => withRepo(showWriting), { code: 'UnsafePath' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
