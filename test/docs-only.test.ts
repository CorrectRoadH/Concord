import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { ProjectSchema } from '../dist/shared.js';
import { readProjectConfig, writeProjectConfig } from './support.js';

// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
test('packed CLI manages documentation without test roots and can later discover real tests', () => Effect.runPromise(Effect.sync(() => {
  const scratch = mkdtempSync(join(tmpdir(), 'concord-docs-only-'));
  try {
    const packed = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.Struct({ filename: Schema.String }))))(
      execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', scratch], { cwd: resolve('.'), encoding: 'utf8', timeout: 60000 }),
    );
    assert.ok(packed[0]);
    const install = join(scratch, 'tool');
    mkdirSync(install);
    writeFileSync(join(install, 'package.json'), JSON.stringify({ private: true }));
    execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline', join(scratch, packed[0].filename)], { cwd: install, encoding: 'utf8', timeout: 60000 });
    const cli = join(install, 'node_modules/concord-sdlc/dist/entry.js');
    const root = join(scratch, 'consumer');
    mkdirSync(root);
    execFileSync('git', ['init', '-q', root]);
    function call<A>(args: readonly string[], schema: Schema.ConstraintDecoder<A, never>, status = 0): A {
      const result = spawnSync(process.execPath, [cli, '--root', root, '--json', ...args], { encoding: 'utf8', timeout: 20000 });
      assert.equal(result.status, status, result.stdout + result.stderr);
      const output = result.stdout || result.stderr;
      try { return Schema.decodeUnknownSync(Schema.fromJsonString(schema))(output); }
      catch (cause) { throw new Error(`Could not decode ${args.join(' ')} output ${JSON.stringify(output)}`, { cause }); }
    }
    const ack = Schema.Struct({});
    const diagnosis = Schema.Struct({ cases: Schema.Int, missingTestRoots: Schema.Array(Schema.String), nextSteps: Schema.Array(Schema.String) });
    assert.equal(call(['init', '--docs-only', '--test-root', 'test'], Schema.Struct({ error: Schema.String }), 1).error, 'ConflictingOptions');
    assert.equal(existsSync(join(root, 'concord.config.ts')), false);
    call(['--dry-run', 'init', '--docs-only'], ack);
    assert.equal(existsSync(join(root, 'concord.config.ts')), false);
    call(['init', '--docs-only'], ack);
    const config = readProjectConfig(root);
    assert.deepEqual(config.testRoots, []);
    call(['feature', 'create', 'backup', '--title', 'Backup'], ack);
    call(['feature', 'page', 'add', 'backup', 'migration'], ack);
    const pageSchema = Schema.Struct({ body: Schema.String, digest: Schema.String });
    const page = call(['feature', 'page', 'show', 'backup', 'migration'], pageSchema);
    const prose = join(scratch, 'migration.md');
    writeFileSync(prose, '# Migration\n\nPreserve historical plans and their decisions.\n');
    call(['feature', 'page', 'set', 'backup', 'migration', '--body', prose, '--expected-digest', page.digest], ack);
    assert.match(call(['feature', 'page', 'show', 'backup', 'migration'], pageSchema).body, /Preserve historical plans/);
    assert.equal(call(['feature', 'page', 'set', 'backup', 'migration', '--body', prose, '--expected-digest', page.digest], Schema.Struct({ error: Schema.String }), 1).error, 'PreimageChanged');
    for (const invalid of ['../escape', '/absolute', 'nested/page', 'README.md']) {
      assert.equal(call(['feature', 'page', 'add', 'backup', invalid], Schema.Struct({ error: Schema.String }), 1).error, 'InvalidPage');
    }
    call(['design', 'create', 'storage', '--title', 'Storage', '--alternative', 'files'], ack);
    call(['design', 'page', 'add', 'storage', 'evaluation-history'], ack);
    call(['design', 'page', 'add', 'storage', 'migration', '--plan', 'files'], ack);
    assert.equal(existsSync(join(root, 'docs/design/storage/evaluation-history.md')), true);
    assert.equal(existsSync(join(root, 'docs/design/storage/plans/files/migration.md')), true);
    assert.equal(call(['design', 'page', 'add', 'storage', 'migration', '--plan', 'unknown'], Schema.Struct({ error: Schema.String }), 1).error, 'InvalidPlan');
    const initial = call(['doctor'], diagnosis);
    assert.equal(initial.cases, 0);
    assert.deepEqual(initial.missingTestRoots, []);
    assert.ok(initial.nextSteps.some(step => step.includes('--skill document')));
    assert.equal(call(['check'], Schema.Struct({ ok: Schema.Boolean })).ok, true);
    assert.deepEqual(call(['trace', 'show', 'backup'], Schema.Struct({ tests: Schema.Array(Schema.Unknown) })).tests, []);
    assert.equal(existsSync(join(root, 'test')), false);
    mkdirSync(join(root, 'test'));
    writeFileSync(join(root, 'test/backup.test.mjs'), "import test from 'node:test';\n// @feature docs/feature/backup/README.md\ntest('backup', () => {});\n");
    assert.equal(call(['doctor'], diagnosis).cases, 0, 'empty roots disable discovery even when test files exist');
    writeProjectConfig(root, { ...config, testRoots: ['test'] });
    assert.equal(call(['doctor'], diagnosis).cases, 1);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
})));
