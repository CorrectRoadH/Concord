import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Schema } from 'effect';
import { createFixConsumer, gitCommand, gitCommit } from '../support/fix-consumer.ts';
import { runCli } from '../support/cli.ts';

const Result = Schema.Struct({ operation: Schema.Literal('test-verify'), base: Schema.String, redTree: Schema.String, greenTree: Schema.String, tests: Schema.Array(Schema.String), conclusion: Schema.String });
async function invoke(root: string, args: readonly string[]) {
  return await runCli({ cwd: root, env: process.env, argv: ['--root', root, '--server=command', '--json', ...args] });
}
async function stagedFixture() {
  const fixture = await createFixConsumer();
  const source = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { quantity } from '../src/cart.ts';\n// @feature docs/feature/cart/README.md\n// @name quantity accumulates\ntest('quantity accumulates', () => assert.equal(quantity, 1));\n// @feature docs/feature/cart/README.md\n// @name unchanged sanity\ntest('unchanged sanity', () => assert.ok(quantity > 0));\n";
  writeFileSync(join(fixture.root, 'test/cart.test.ts'), source);
  const base = gitCommit(fixture.root, 'baseline cases');
  writeFileSync(join(fixture.root, 'test/cart.test.ts'), source.replace('equal(quantity, 1)', 'equal(quantity, 2)'));
  writeFileSync(join(fixture.root, 'src/cart.ts'), 'export const quantity = 2;\n');
  gitCommand(fixture.root, 'add', '.');
  return { ...fixture, base };
}

// @use-case docs/feature/local-sdlc/use-case/verify-fix-in-one-commit.md
test('staged CLI verifies only changed cases and replays the committed trees without changing user state', async () => {
  const fixture = await stagedFixture();
  try {
    writeFileSync(join(fixture.root, 'src/cart.ts'), 'unstaged invalid source');
    const index = readFileSync(join(fixture.root, '.git/index'));
    const result = await invoke(fixture.root, ['test', 'verify', '--staged']);
    assert.equal(result.exitCode, 0, result.stderr);
    const value = Schema.decodeUnknownSync(Schema.fromJsonString(Result), { onExcessProperty: 'ignore' })(result.stdout);
    assert.equal(value.base, fixture.base); assert.equal(value.tests.length, 1);
    assert.match(value.conclusion, /Verified fix/);
    assert.deepEqual(readFileSync(join(fixture.root, '.git/index')), index);
    assert.equal(gitCommand(fixture.root, 'rev-parse', 'HEAD'), fixture.base);
    assert.equal(readFileSync(join(fixture.root, 'src/cart.ts'), 'utf8'), 'unstaged invalid source');
    writeFileSync(join(fixture.root, 'src/cart.ts'), 'export const quantity = 2;\n');
    const fix = gitCommit(fixture.root, 'test and fix together');
    const replay = await invoke(fixture.root, ['test', 'verify', '--fix', fix]);
    assert.equal(replay.exitCode, 0, replay.stderr);
    const replayed = Schema.decodeUnknownSync(Schema.fromJsonString(Result), { onExcessProperty: 'ignore' })(replay.stdout);
    assert.equal(replayed.redTree, value.redTree); assert.equal(replayed.greenTree, value.greenTree);
    const invalid = await invoke(fixture.root, ['test', 'verify', '--staged', '--fix', fix]);
    assert.equal(invalid.exitCode, 1); assert.match(invalid.stderr, /InvalidOption/);
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

// @use-case docs/feature/local-sdlc/use-case/verify-fix-in-one-commit.md#replay
test('fixed Issue closure derives the red snapshot when regression and fix share a commit', async () => {
  const fixture = await stagedFixture();
  try {
    const path = join(fixture.root, 'test/cart.test.ts');
    writeFileSync(path, readFileSync(path, 'utf8').replace('// @name quantity accumulates', '// @issue docs/issues/sku.md\n// @name quantity accumulates'));
    gitCommit(fixture.root, 'test and fix in one commit');
    const result = await invoke(fixture.root, ['issue', 'close', 'sku', '--fixed']);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(existsSync(join(fixture.root, 'docs/issues/sku.md')), false);
    assert.doesNotMatch(readFileSync(path, 'utf8'), /@issue/);
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});
