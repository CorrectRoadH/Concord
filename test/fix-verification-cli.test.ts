import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { before, after, test } from 'node:test';
import { Schema } from 'effect';
import { decode, FixVerificationSchema } from "../src/model/index.js";
import { createFixConsumer } from './support/fix-consumer.js';
import { packConcord, installConcord } from './installed-package.js';

const scratch = mkdtempSync(join(tmpdir(), 'concord-fix-cli-'));
let cli: string;
before(() => {
  const install = join(scratch, 'install'); mkdirSync(install); writeFileSync(join(install, 'package.json'), JSON.stringify({ private: true }));
  installConcord(install, packConcord(scratch)); cli = join(install, 'node_modules/concord-sdlc/dist/entry.js');
});
after(() => rmSync(scratch, { recursive: true, force: true }));
const ObjectSchema = Schema.Record(Schema.String, Schema.Unknown);
function call(root: string, args: readonly string[], status = 0) {
  const result = spawnSync(process.execPath, [cli, '--root', root, '--json', ...args], { cwd: root, encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, status, JSON.stringify({ args, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr }));
  return decode(ObjectSchema, JSON.parse(result.stdout.trim() || result.stderr), 'CLI result');
}
// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#close-fixed
test('packed close fixed records commits, verify replays without writing, and since accepts the worktree', t => {
  const f = createFixConsumer(); t.after(() => rmSync(f.root, { recursive: true, force: true }));
  const receipts = join(f.root, '.git/concord/evidence'); mkdirSync(receipts, { recursive: true });
  writeFileSync(join(receipts, 'historical.json'), 'preserved legacy receipt');
  writeFileSync(join(f.root, 'concord.repository.json'), '{legacy-profile-is-not-current-input');
  const fix = f.fix();
  const closed = call(f.root, ['issue', 'close', 'sku', '--fixed', '--reason', 'Accumulate quantities']);
  const verification = decode(FixVerificationSchema, closed.verification, 'verification');
  assert.deepEqual({ defect: verification.defect, fix: verification.fix }, { defect: f.defect, fix });
  const before = readFileSync(join(f.root, 'docs/issues/sku.md'), 'utf8');
  const replay = call(f.root, ['test', 'verify', 'sku']); assert.equal(replay.verified, 'replayed');
  assert.equal(readFileSync(join(f.root, 'docs/issues/sku.md'), 'utf8'), before);
  const current = call(f.root, ['check']);
  assert.deepEqual(current.verifications, [{ path: 'docs/issues/sku.md', verified: 'recorded', verification }]);
  const check = call(f.root, ['check', '--since', f.defect]);
  assert.deepEqual(check.since, { base: f.defect, target: 'worktree', scope: 'endpoints' });
  assert.deepEqual(check.verifications, [{ path: 'docs/issues/sku.md', verified: 'replayed', verification }]);
  assert.equal(check.ok, true); assert.equal(check.complete, true);
  assert.deepEqual(readdirSync(receipts), ['historical.json']);
  assert.equal(readFileSync(join(receipts, 'historical.json'), 'utf8'), 'preserved legacy receipt');
  assert.equal(readFileSync(join(f.root, 'concord.repository.json'), 'utf8'), '{legacy-profile-is-not-current-input');
  const listed = call(f.root, ['test', 'list']);
  const cases = decode(Schema.Array(Schema.Unknown), listed.cases, 'cases');
  assert.equal(cases.length, 1);
  assert.deepEqual(decode(ObjectSchema, cases[0], 'case').issues, ['docs/issues/sku.md']);
});
// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#结果
test('packed verification error codes preserve the Issue owner', async t => {
  for (const [name, options, fix, expected] of [
    ['green defect', { greenAtDefect: true }, false, 'FixUnverifiable'],
    ['unfixed target', {}, false, 'FixVerificationFailed'],
    ['changed HEAD', { runner: 'move-head' }, true, 'PreimageChanged'],
  ] as const) await t.test(name, () => {
    const f = createFixConsumer(options); try {
      if (fix) f.fix(); const before = readFileSync(join(f.root, 'docs/issues/sku.md'), 'utf8');
      assert.equal(call(f.root, ['issue', 'close', 'sku', '--fixed', '--reason', 'Candidate'], 1).error, expected);
      assert.equal(readFileSync(join(f.root, 'docs/issues/sku.md'), 'utf8'), before);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
});
// @feature docs/feature/local-sdlc/cli.md#检查本次变化
test('packed since rejects an unavailable baseline as InvalidBase', t => {
  const f = createFixConsumer(); t.after(() => rmSync(f.root, { recursive: true, force: true })); f.fix();
  assert.equal(call(f.root, ['check', '--since', 'missing-commit'], 1).error, 'InvalidBase');
  assert.equal(call(f.root, ['test', 'verify', 'sku'], 1).error, 'FixUnverifiable');
});
