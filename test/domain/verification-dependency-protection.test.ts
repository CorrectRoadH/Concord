import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { verifyChanges } from '../../src/domain/tests/index.ts';
import { ConcordError } from '../../src/model/index.ts';
import { createFixConsumer, gitCommit } from '../support/fix-consumer.ts';
import { runApplication } from '../support/repository.ts';
import { readProjectConfig, writeProjectConfig } from '../support/support.ts';

async function consumer(pnpm: boolean) {
  const fixture = await createFixConsumer();
  writeFileSync(join(fixture.root, '.gitignore'), 'node_modules/\n');
  mkdirSync(join(fixture.root, 'node_modules'));
  writeFileSync(join(fixture.root, 'node_modules/sentinel.txt'), 'borrowed dependency');
  writeFileSync(join(fixture.root, 'package.json'), JSON.stringify({ name: 'private-verification-fixture', private: true, packageManager: 'pnpm@11.18.0' }));
  writeFileSync(join(fixture.root, 'node_modules/.pnpm-workspace-state-v1.json'), JSON.stringify({ projects: { [fixture.root]: { name: 'private-verification-fixture' } }, settings: {} }));
  writeFileSync(join(fixture.root, 'node_modules/.modules.yaml'), JSON.stringify({ layoutVersion: -1, storeDir: join(fixture.root, 'private-store'), virtualStoreDir: join(fixture.root, 'node_modules/.pnpm') }));
  const source = `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { quantity } from '../src/cart.ts';\nimport { writeFileSync } from 'node:fs';\n// @feature docs/feature/cart/README.md\ntest('quantity accumulates', () => {\n${pnpm ? "assert.equal(process.env.CONCORD_VERIFICATION, '1'); assert.equal(process.env.pnpm_config_verify_deps_before_run, 'false'); assert.equal(process.env.npm_config_verify_deps_before_run, 'false'); assert.notEqual(process.stdin.isTTY, true);" : "writeFileSync('node_modules/injected-entry', 'runner mutation'); console.error('dependency mutation observed');"}\nassert.equal(quantity, 1);\n});\n`;
  writeFileSync(join(fixture.root, 'test/cart.test.ts'), source);
  const config = await readProjectConfig(fixture.root);
  writeProjectConfig(fixture.root, { ...config, runner: { kind: 'command', argv: [...(pnpm ? ['pnpm', 'exec'] : []), process.execPath, 'test', '{file}'], timeoutMs: 10000 } });
  gitCommit(fixture.root, 'borrowed private dependencies');
  writeFileSync(join(fixture.root, 'test/cart.test.ts'), source.replace('equal(quantity, 1)', 'equal(quantity, 2)'));
  writeFileSync(join(fixture.root, 'src/cart.ts'), 'export const quantity = 2;\n');
  gitCommit(fixture.root, 'regression and fix');
  return fixture;
}

// @use-case docs/feature/local-sdlc/use-case/verify-fix-in-one-commit.md#replay
test('verification disables real pnpm automatic installs and preserves borrowed dependency sentinel', { skip: Bun.which('pnpm') === null ? 'real pnpm is not installed' : false }, async () => {
  const fixture = await consumer(true);
  try {
    const result = await runApplication(verifyChanges(fixture.root, 'HEAD'));
    assert.equal(result.red[0]!.exitCode, 1); assert.equal(result.green[0]!.exitCode, 0);
    assert.equal(readFileSync(join(fixture.root, 'node_modules/sentinel.txt'), 'utf8'), 'borrowed dependency');
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

// @use-case docs/feature/local-sdlc/use-case/verify-fix-in-one-commit.md#replay
test('verification stops after a runner modifies borrowed dependencies and retains process diagnostics', async () => {
  const fixture = await consumer(false);
  try {
    await assert.rejects(runApplication(verifyChanges(fixture.root, 'HEAD')), error => {
      assert.ok(error instanceof ConcordError); assert.equal(error.code, 'DependenciesModified');
      assert.match(error.message, /node_modules/); assert.match(error.message, /injected-entry/); assert.match(error.message, /reinstall/i);
      const details = error.details as { process: { commit: string; step: string; stderr: string } };
      assert.match(details.process.commit, /^defect /); assert.equal(details.process.step, 'runner command');
      assert.match(details.process.stderr, /dependency mutation observed/); return true;
    });
    assert.ok(existsSync(join(fixture.root, 'node_modules/injected-entry')));
    assert.ok(!existsSync(join(fixture.root, '.git/concord/runner.lease')));
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});
