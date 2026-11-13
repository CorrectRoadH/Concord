import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { executeViewAction } from '../../src/app/index.ts';
import { Publication } from '../../src/base/publication/index.ts';
import { createFixConsumer, gitCommit } from '../support/fix-consumer.ts';
import { runApplication } from '../support/repository.ts';

// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#close-fixed
test('verified closure guards Issue and regression sources while unrelated tracked test edits may proceed', async () => {
  for (const target of ['unrelated', 'issue', 'regression'] as const) {
    const fixture = await createFixConsumer();
    try {
      const unrelated = 'test/other.test.ts', issue = 'docs/issues/sku.md', regression = 'test/cart.test.ts';
      writeFileSync(join(fixture.root, unrelated), '// @feature docs/feature/cart/README.md\n// @name unrelated\nexport const unrelated = true;\n');
      gitCommit(fixture.root, 'unrelated tracked test');
      const fix = fixture.fix();
      let edited = false;
      const path = target === 'unrelated' ? unrelated : target === 'issue' ? issue : regression;
      const before = readFileSync(join(fixture.root, path), 'utf8');
      // The real planner reads the project, then the external writer edits one file before CAS.
      const action = Effect.flatMap(Publication, publication => executeViewAction(fixture.root, { action: 'issue.close', id: 'sku', fixed: true, defect: fixture.defect, fix }).pipe(Effect.provideService(Publication, {
        ...publication,
        validation: { ...publication.validation, planIssueClose: async (repo, request) => {
          const plan = await publication.validation.planIssueClose(repo, request);
          if (!edited) { edited = true; writeFileSync(join(fixture.root, path), `${before}\n// concurrent edit\n`); }
          return plan;
        } },
      })));
      if (target === 'unrelated') {
        await runApplication(action);
        assert.equal(existsSync(join(fixture.root, issue)), false);
        assert.doesNotMatch(readFileSync(join(fixture.root, regression), 'utf8'), /@issue/);
      } else {
        await assert.rejects(runApplication(action), { code: 'FileChangedSinceRead' });
        assert.equal(existsSync(join(fixture.root, issue)), true);
        assert.match(readFileSync(join(fixture.root, regression), 'utf8'), /@issue/);
      }
      assert.equal(edited, true);
      assert.equal(readFileSync(join(fixture.root, path), 'utf8'), `${before}\n// concurrent edit\n`);
      assert.equal(existsSync(join(fixture.root, '.git/concord/journal.json')), false);
    } finally { rmSync(fixture.root, { recursive: true, force: true }); }
  }
});

// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#close-fixed
test('verification may observe a tracked file edit during the green runner but preserves both target preimages', async () => {
  for (const target of ['unrelated', 'issue', 'regression'] as const) {
    const fixture = await createFixConsumer();
    try {
      const issue = 'docs/issues/sku.md', regression = 'test/cart.test.ts', unrelated = 'test/unrelated.test.ts';
      writeFileSync(join(fixture.root, unrelated), '// @feature docs/feature/cart/README.md\nexport const unrelated = true;\n');
      const path = target === 'unrelated' ? unrelated : target === 'issue' ? issue : regression;
      const source = readFileSync(join(fixture.root, regression), 'utf8');
      writeFileSync(join(fixture.root, regression), source + `\nimport { appendFileSync } from 'node:fs';\nif (quantity === 2) appendFileSync(${JSON.stringify(join(fixture.root, path))}, '\\n// edited during green\\n');\n`);
      const defect = gitCommit(fixture.root, 'concurrent external edit during verification');
      const fix = fixture.fix();
      const action = runApplication(executeViewAction(fixture.root, { action: 'issue.close', id: 'sku', fixed: true, defect, fix }));
      if (target === 'unrelated') {
        await action;
        assert.equal(existsSync(join(fixture.root, issue)), false);
        assert.doesNotMatch(readFileSync(join(fixture.root, regression), 'utf8'), /^\/\/ @issue/m);
      } else {
        await assert.rejects(action, { code: 'FileChangedSinceRead' });
        assert.equal(existsSync(join(fixture.root, issue)), true);
        assert.match(readFileSync(join(fixture.root, regression), 'utf8'), /^\/\/ @issue/m);
      }
      assert.match(readFileSync(join(fixture.root, path), 'utf8'), /edited during green/);
      assert.equal(existsSync(join(fixture.root, '.git/concord/runner.lease')), false);
    } finally { rmSync(fixture.root, { recursive: true, force: true }); }
  }
});
