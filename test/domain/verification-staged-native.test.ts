import assert from 'node:assert/strict';
import { copyFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { verifyChanges } from '../../src/domain/tests/index.ts';
import { ConcordError } from '../../src/model/index.ts';
import { createFixConsumer, gitCommand, gitCommit } from '../support/fix-consumer.ts';
import { LocalRepository, runApplication } from '../support/repository.ts';
import { readProjectConfig, writeProjectConfig } from '../support/support.ts';

// @use-case docs/feature/local-sdlc/use-case/verify-fix-in-one-commit.md#verify-staged
test('derived native verification keeps exact case scope and rejects provider infrastructure failures', async () => {
  for (const mode of ['green', 'parser-failed'] as const) {
    const fixture = await createFixConsumer(); let repo: LocalRepository | undefined;
    try {
      writeFileSync(join(fixture.root, '.gitignore'), 'node_modules/\n');
      symlinkSync(fileURLToPath(new URL('../../node_modules', import.meta.url)), join(fixture.root, 'node_modules'), 'dir');
      copyFileSync(new URL('../fixtures/process-adapter.ts', import.meta.url), join(fixture.root, 'adapter.ts'));
      writeFileSync(join(fixture.root, 'mode.txt'), 'red');
      writeFileSync(join(fixture.root, 'fixture.lock'), 'locked');
      writeFileSync(join(fixture.root, 'test/native.ts'), '// @feature docs/feature/cart/README.md\nconst regression = false;\n');
      writeProjectConfig(fixture.root, { ...await readProjectConfig(fixture.root), testAdapters: [{ id: 'external', include: ['test/native.ts'], argv: [process.execPath, 'adapter.ts'], implementationFiles: ['adapter.ts'], inputRoots: [], frameworkVersion: 'fixture/v1', lockFiles: ['fixture.lock'], envNames: ['PATH'] }] });
      gitCommit(fixture.root, 'external provider boundary');
      writeFileSync(join(fixture.root, 'test/native.ts'), '// @feature docs/feature/cart/README.md\nconst regression = true;\n');
      writeFileSync(join(fixture.root, 'mode.txt'), mode); gitCommand(fixture.root, 'add', '.');
      repo = await LocalRepository.open(fixture.root);
      if (mode === 'green') {
        const result = await runApplication(verifyChanges(repo));
        assert.equal(result.tests.length, 1);
        assert.equal(result.red[0]!.scope, 'case'); assert.equal(result.green[0]!.scope, 'case');
        assert.equal(result.red[0]!.commandOutcome, 'red'); assert.equal(result.green[0]!.commandOutcome, 'green');
      } else {
        await assert.rejects(runApplication(verifyChanges(repo)), error => {
          assert.ok(error instanceof ConcordError); assert.equal(error.code, 'FixUnverifiable');
          const details = error.details as { process: { commit: string; op: string; stderr: string } };
          assert.match(details.process.commit, /^fix /); assert.equal(details.process.op, 'report-parse');
          assert.match(details.process.stderr, /broken report codec/);
          return true;
        });
      }
    } finally { repo?.close(); rmSync(fixture.root, { recursive: true, force: true }); }
  }
});
