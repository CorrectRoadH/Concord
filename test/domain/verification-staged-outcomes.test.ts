import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { verifyChanges, verifyTest, scanAnnotations } from '../../src/domain/tests/index.ts';
import { ConcordError } from '../../src/model/index.ts';
import { LocalRepository, runApplication } from '../support/repository.ts';
import { stagedVerificationFixture } from '../support/staged-verification.ts';
import { createFixConsumer, gitCommand } from '../support/fix-consumer.ts';

async function verify(root: string) {
  return await runApplication(verifyChanges(root));
}

// @use-case docs/feature/local-sdlc/use-case/verify-fix-in-one-commit.md#verify-staged
test('unnamed changed markers share one file run while Tests retains both selected IDs', async () => {
  const fixture = await stagedVerificationFixture();
  try {
    fixture.editTest(source => source.replace('// @name quantity accumulates\n', '').replace('// @name unchanged sanity\n', '').replace('quantity > 0', 'quantity === 2'));
    const result = await verify(fixture.root);
    assert.equal(result.tests.length, 2);
    for (const results of [result.red, result.green]) { assert.equal(results.length, 1); assert.equal(results[0]!.scope, 'file'); }
    assert.equal(result.red[0]!.exitCode, 1); assert.equal(result.green[0]!.exitCode, 0);
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

// @use-case docs/feature/local-sdlc/use-case/verify-fix-in-one-commit.md#verify-staged
test('derived verification refuses an empty selection, red success, green failure and changed dependency locks', async () => {
  for (const scenario of ['preamble', 'red-passed', 'green-failed', 'lock-changed', 'timeout'] as const) {
    const fixture = await stagedVerificationFixture(scenario === 'timeout' ? 500 : undefined);
    try {
      if (scenario === 'timeout') fixture.editTest(source => source + '\nsetInterval(() => {}, 1000);\n');
      if (scenario === 'preamble') { writeFileSync(join(fixture.root, 'test/cart.test.ts'), `// ordinary preamble\n${fixture.source}`); fixture.stage(); }
      if (scenario === 'red-passed') fixture.editTest(source => source.replace('equal(quantity, 2)', 'equal(quantity, 1) /* exact body change */'));
      if (scenario === 'green-failed') { writeFileSync(join(fixture.root, 'src/cart.ts'), 'export const quantity = 3;\n'); fixture.stage(); }
      if (scenario === 'lock-changed') {
        writeFileSync(join(fixture.root, 'bun.lock'), 'baseline dependencies\n');
        gitCommand(fixture.root, 'add', 'bun.lock');
        gitCommand(fixture.root, 'commit', '-qm', 'baseline dependency lock', '--only', 'bun.lock');
        writeFileSync(join(fixture.root, 'bun.lock'), 'changed dependencies\n'); fixture.stage();
      }
      const index = readFileSync(join(fixture.root, '.git/index'));
      await assert.rejects(verify(fixture.root), error => {
        assert.ok(error instanceof ConcordError);
        assert.equal(error.code, scenario === 'green-failed' ? 'FixVerificationFailed' : 'FixUnverifiable');
        if (scenario === 'preamble') assert.match(error.message, /No new or changed/);
        if (scenario === 'red-passed') assert.match(error.message, /passed on the red snapshot/);
        if (scenario === 'lock-changed') assert.match(error.message, /bun.lock/);
        if (scenario === 'timeout') {
          const details = error.details as { process: { timedOut: boolean; commit: string } };
          assert.equal(details.process.timedOut, true); assert.match(details.process.commit, /^defect /);
        }
        if (scenario === 'green-failed') {
          const details = error.details as { process: { commit: string; stderr: string; stdout: string } };
          assert.match(details.process.commit, /^fix /); assert.match(details.process.stdout + details.process.stderr, /3 !== 2|actual: 3/);
        }
        return true;
      });
      assert.deepEqual(readFileSync(join(fixture.root, '.git/index')), index);
      assert.equal(existsSync(join(fixture.root, '.git/concord/runner.lease')), false);
    } finally { rmSync(fixture.root, { recursive: true, force: true }); }
  }
});

// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#verify
test('explicit two-commit replay preserves command evidence scope', async () => {
  const fixture = await createFixConsumer(); let repo: LocalRepository | undefined;
  try {
    const fix = fixture.fix(); repo = await LocalRepository.open(fixture.root);
    const scan = await scanAnnotations(repo, { cache: 'off', sourceMode: 'overlay' });
    const result = await runApplication(verifyTest(repo, scan.cases[0]!.id, fixture.defect, fix));
    assert.equal(result.red[0]!.scope, 'command'); assert.equal(result.green[0]!.scope, 'command');
  } finally { repo?.close(); rmSync(fixture.root, { recursive: true, force: true }); }
});
