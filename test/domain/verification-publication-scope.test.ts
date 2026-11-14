import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { executeViewAction } from '../../src/app/index.ts';
import { Publication } from '../../src/base/publication/index.ts';
import { createFixConsumer } from '../support/fix-consumer.ts';
import { runApplication } from '../support/repository.ts';

// @feature docs/feature/local-sdlc/cli.md#测试关联与-issue-关闭
test('Issue closure rejects concurrent source drift and retries against a fresh snapshot', async () => {
  for (const target of ['unrelated', 'issue', 'regression'] as const) {
    const fixture = await createFixConsumer();
    try {
      const unrelated = 'test/other.test.ts', issue = 'docs/issues/sku.md', regression = 'test/cart.test.ts';
      writeFileSync(join(fixture.root, unrelated), '// @feature docs/feature/cart/README.md\n// @name unrelated\nexport const unrelated = true;\n');
      let edited = false;
      const path = target === 'unrelated' ? unrelated : target === 'issue' ? issue : regression;
      const before = new Map([issue, regression, unrelated].map(file => [file, readFileSync(join(fixture.root, file), 'utf8')]));
      const concurrent = `${target === 'unrelated' ? before.get(path)!.replace('export const unrelated', '// @issue docs/issues/sku.md\nexport const unrelated') : before.get(path)!}\n// concurrent edit\n`;
      // The real planner reads the project, then the external writer edits one file before CAS.
      const action = Effect.flatMap(Publication, publication => executeViewAction(fixture.root, { action: 'issue.close', id: 'sku', reason: 'Handled' }).pipe(Effect.provideService(Publication, {
        ...publication,
        validation: { ...publication.validation, planIssueClose: async (repo, request) => {
          const plan = await publication.validation.planIssueClose(repo, request);
          if (!edited) { edited = true; writeFileSync(join(fixture.root, path), concurrent); }
          return plan;
        } },
      })));
      await assert.rejects(runApplication(action), { code: 'FileChangedSinceRead' });
      assert.equal(edited, true);
      for (const [file, source] of before) {
        assert.equal(readFileSync(join(fixture.root, file), 'utf8'), file === path ? concurrent : source, 'Rejected closure must preserve every file, including the external edit');
      }
      assert.equal(existsSync(join(fixture.root, '.git/concord/journal.json')), false);

      await runApplication(executeViewAction(fixture.root, { action: 'issue.close', id: 'sku', reason: 'Handled after refreshing' }));
      assert.equal(existsSync(join(fixture.root, issue)), false);
      for (const file of [regression, unrelated]) {
        const source = file === path ? concurrent : before.get(file)!;
        assert.equal(readFileSync(join(fixture.root, file), 'utf8'), source.replace('// @issue docs/issues/sku.md\n', ''), 'Fresh closure removes all current Issue markers while preserving test bodies and external edits');
      }
      assert.equal(existsSync(join(fixture.root, '.git/concord/journal.json')), false);
    } finally { rmSync(fixture.root, { recursive: true, force: true }); }
  }
});
