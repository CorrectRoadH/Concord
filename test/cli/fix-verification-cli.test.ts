import { packageBin } from '../support/installed-package.ts';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from '../support/temporary.ts';
import { before, after, test } from 'node:test';
import { Schema } from 'effect';
import { decode, FixVerificationSchema } from "../../src/model/index.ts";
import { createFixConsumer, gitCommand, gitCommit } from '../support/fix-consumer.ts';
import { sourceConcord, prepareSourceConsumer } from '../support/installed-package.ts';

const scratch = mkdtempSync(join(tmpdir(), 'concord-fix-cli-'));
let cli: string;
before(() => {
  const install = join(scratch, 'install'); mkdirSync(install); writeFileSync(join(install, 'package.json'), JSON.stringify({ private: true }));
  prepareSourceConsumer(install, sourceConcord()); cli = packageBin(join(install, 'node_modules/concord-sdlc'));
});
after(() => rmSync(scratch, { recursive: true, force: true }));
const ObjectSchema = Schema.Record(Schema.String, Schema.Unknown);
function call(root: string, args: readonly string[], status = 0) {
  const result = spawnSync(process.execPath, [cli, '--root', root, '--json', ...args], { cwd: root, encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, status, JSON.stringify({ args, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr }));
  return decode(ObjectSchema, JSON.parse(result.stdout.trim() || result.stderr), 'CLI result');
}
// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#close-fixed
test('packed close fixed prints commit evidence, deletes the Issue, and verifies explicit commits without writing', t => {
  const f = createFixConsumer(); t.after(() => rmSync(f.root, { recursive: true, force: true }));
  const receipts = join(f.root, '.git/concord/evidence'); mkdirSync(receipts, { recursive: true });
  writeFileSync(join(receipts, 'historical.json'), 'preserved legacy receipt');
  writeFileSync(join(f.root, 'concord.repository.json'), '{legacy-profile-is-not-current-input');
  const fix = f.fix();
  const closed = call(f.root, ['issue', 'close', 'sku', '--fixed', '--reason', 'Accumulate quantities']);
  const verification = decode(FixVerificationSchema, closed.verification, 'verification');
  assert.deepEqual({ defect: verification.defect, fix: verification.fix }, { defect: f.defect, fix });
  assert.throws(() => readFileSync(join(f.root, 'docs/issues/sku.md')), /ENOENT/u);
  const replay = call(f.root, ['test', 'verify', '--defect', f.defect, '--fix', fix, verification.tests[0]!]);
  assert.equal(replay.verified, 'replayed');
  const current = call(f.root, ['check']);
  assert.equal('verifications' in current, false);
  assert.deepEqual(readdirSync(receipts), ['historical.json']);
  assert.equal(readFileSync(join(receipts, 'historical.json'), 'utf8'), 'preserved legacy receipt');
  assert.equal(readFileSync(join(f.root, 'concord.repository.json'), 'utf8'), '{legacy-profile-is-not-current-input');
  const listed = call(f.root, ['test', 'list']);
  const cases = decode(Schema.Array(Schema.Unknown), listed.cases, 'cases');
  assert.equal(cases.length, 1);
  assert.deepEqual(decode(ObjectSchema, cases[0], 'case').issues, []);
  assert.ok(!readFileSync(join(f.root, 'test/cart.test.ts'), 'utf8').includes('@issue'));
});
// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#结果
test('packed verification rejects green defects and failing fix candidates without changing the Issue', async t => {
  for (const [name, options, expected] of [
    ['green defect', { greenAtDefect: true }, 'FixUnverifiable'],
    ['unfixed target', {}, 'FixVerificationFailed'],
  ] as const) await t.test(name, () => {
    const f = createFixConsumer(options); try {
      writeFileSync(join(f.root, 'candidate.txt'), 'Candidate after the regression commit\n');
      const candidate = gitCommit(f.root, 'candidate without a fix');
      assert.equal(gitCommand(f.root, 'rev-parse', `${candidate}^`), f.defect);
      const before = readFileSync(join(f.root, 'docs/issues/sku.md'), 'utf8');
      assert.equal(call(f.root, ['issue', 'close', 'sku', '--fixed', '--reason', 'Candidate'], 1).error, expected);
      assert.equal(readFileSync(join(f.root, 'docs/issues/sku.md'), 'utf8'), before);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
});
// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#close-fixed
test('packed close fixed accepts a parallel commit and records the initially captured fix', t => {
  const f = createFixConsumer({ runner: 'move-head' });
  t.after(() => rmSync(f.root, { recursive: true, force: true }));
  const fix = f.fix();
  const closed = call(f.root, ['issue', 'close', 'sku', '--fixed', '--reason', 'Accumulate quantities']);
  const verification = decode(FixVerificationSchema, closed.verification, 'verification');
  assert.deepEqual({ defect: verification.defect, fix: verification.fix }, { defect: f.defect, fix });
  assert.notEqual(gitCommand(f.root, 'rev-parse', 'HEAD'), fix);
  assert.equal(gitCommand(f.root, 'rev-parse', 'HEAD^'), fix);
  assert.equal(readFileSync(join(f.root, 'parallel.txt'), 'utf8'), 'Independent commit\n');
  assert.equal('verifications' in call(f.root, ['check']), false);
});
// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#结果
test('packed close fixed returns FileChangedSinceRead and preserves an Issue edited during verification', t => {
  const f = createFixConsumer({ runner: 'edit-issue' });
  t.after(() => rmSync(f.root, { recursive: true, force: true }));
  f.fix();
  const path = join(f.root, 'docs/issues/sku.md');
  const before = readFileSync(path, 'utf8');
  assert.equal(call(f.root, ['issue', 'close', 'sku', '--fixed', '--reason', 'Candidate'], 1).error, 'FileChangedSinceRead');
  assert.equal(readFileSync(path, 'utf8'), before + '\nConcurrent Issue note.\n');
});
