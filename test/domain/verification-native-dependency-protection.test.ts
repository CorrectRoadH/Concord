import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { verifyChanges } from '../../src/domain/tests/index.ts';
import { ConcordError } from '../../src/model/index.ts';
import { createFixConsumer, gitCommit } from '../support/fix-consumer.ts';
import { runApplication } from '../support/repository.ts';
import { readProjectConfig, writeProjectConfig } from '../support/support.ts';

// @use-case docs/feature/local-sdlc/use-case/verify-fix-in-one-commit.md#replay
test('native adapter exchanges and planned invocations receive verification protection and stop on dependency mutation', async () => {
  for (const mutation of ['none', 'collect-plan', 'run', 'report-parse']) {
    const fixture = await createFixConsumer();
    try {
      writeFileSync(join(fixture.root, '.gitignore'), 'node_modules/\n'); mkdirSync(join(fixture.root, 'node_modules'));
      writeFileSync(join(fixture.root, 'node_modules/sentinel'), 'borrowed');
      copyFileSync(new URL('../fixtures/dependency-protection-adapter.ts', import.meta.url), join(fixture.root, 'adapter.ts'));
      writeFileSync(join(fixture.root, 'mutation.txt'), mutation);
      writeFileSync(join(fixture.root, 'test/native.ts'), '// @feature docs/feature/cart/README.md\nconst regression = false;\n');
      const config = await readProjectConfig(fixture.root);
      writeProjectConfig(fixture.root, { ...config, testAdapters: [{ id: 'external', include: ['test/native.ts'], argv: [process.execPath, 'adapter.ts'], implementationFiles: ['adapter.ts'], inputRoots: [], frameworkVersion: 'fixture/1', lockFiles: [], envNames: ['PATH'] }] });
      gitCommit(fixture.root, 'native protection fixture');
      writeFileSync(join(fixture.root, 'test/native.ts'), '// @feature docs/feature/cart/README.md\nconst regression = true;\n');
      writeFileSync(join(fixture.root, 'src/cart.ts'), 'export const quantity = 2;\n'); gitCommit(fixture.root, 'regression and fix');
      if (mutation === 'none') {
        const result = await runApplication(verifyChanges(fixture.root, 'HEAD'));
        assert.equal(result.red[0]!.commandOutcome, 'red'); assert.equal(result.green[0]!.commandOutcome, 'green');
      } else await assert.rejects(runApplication(verifyChanges(fixture.root, 'HEAD')), error => {
        assert.ok(error instanceof ConcordError); assert.equal(error.code, 'DependenciesModified');
        const details = error.details as { process: { commit: string; step: string; op?: string; stderr: string } };
        assert.match(details.process.commit, /^defect /);
        assert.equal(details.process.step, mutation === 'run' ? 'native invocation' : 'adapter exchange');
        assert.equal(details.process.op, mutation === 'run' ? undefined : mutation);
        assert.match(details.process.stderr, new RegExp(mutation)); return true;
      });
      assert.equal(readFileSync(join(fixture.root, 'node_modules/sentinel'), 'utf8'), 'borrowed');
    } finally { rmSync(fixture.root, { recursive: true, force: true }); }
  }
});
