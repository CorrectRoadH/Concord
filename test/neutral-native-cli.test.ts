import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';

const PackSchema = Schema.Array(Schema.Struct({ filename: Schema.String }));
const CaseListSchema = Schema.Struct({
  cases: Schema.Array(Schema.Struct({ id: Schema.String, file: Schema.String, name: Schema.String }))
});
const CommandEvidenceSchema = Schema.Struct({
  id: Schema.String,
  commandOutcome: Schema.Literals(['pass', 'fail', 'invalid']),
  execution: Schema.Literals(['nonzero', 'zero', 'skipped', 'unknown']),
  exitCode: Schema.NullOr(Schema.Int),
  cleanupOk: Schema.Boolean
});
const InventoryResultSchema = Schema.Struct({ inventory: Schema.String, caseCount: Schema.Int });
const CoreErrorSchema = Schema.Struct({ ok: Schema.Literal(false), error: Schema.String, message: Schema.String });
const ReceiptFactsSchema = Schema.Struct({
  observation: Schema.Literals(['red', 'green', 'reliability']),
  invocationId: Schema.String,
  runner: Schema.Struct({ executor: Schema.String, version: Schema.String, implementationDigest: Schema.String, argv: Schema.Array(Schema.String) }),
  result: Schema.Struct({ exitCode: Schema.NullOr(Schema.Int), signal: Schema.NullOr(Schema.String), timedOut: Schema.Boolean, startupFailed: Schema.Boolean }),
  native: Schema.Struct({
    copyId: Schema.String,
    copyPath: Schema.String,
    sequence: Schema.Int,
    mode: Schema.Literals(['single', 'isolated', 'same', 'parallel']),
    caseCount: Schema.Int,
    passed: Schema.Int,
    failed: Schema.Int,
    skipped: Schema.Int,
    retries: Schema.Int,
    parallelism: Schema.Int
  }),
  cleanup: Schema.Struct({ ok: Schema.Boolean, resources: Schema.Array(Schema.Struct({ kind: Schema.String, path: Schema.String, removed: Schema.Boolean })) })
});
const TakeoverSchema = Schema.Struct({ id: Schema.String, receiptPaths: Schema.Array(Schema.String), candidatePath: Schema.String });

const json = <A>(source: string, schema: Schema.ConstraintDecoder<A, never>): A =>
  Schema.decodeUnknownSync(Schema.fromJsonString(schema))(source);

// @use-case docs/feature/neutral-project-governance/use-case/adopt-neutral-governance.md
test('packed CLI accepts only real neutral Vitest native evidence through the authoritative fixed gate', () => Effect.runPromise(Effect.sync(() => {
  const scratch = mkdtempSync(join(tmpdir(), 'concord-neutral-native-'));
  try {
    const packed = json(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', scratch], {
      cwd: resolve('.'), encoding: 'utf8', timeout: 60_000
    }), PackSchema);
    assert.ok(packed[0]);
    const root = join(scratch, 'consumer');
    cpSync(resolve('test/fixtures/neutral-native'), root, { recursive: true });
    renameSync(join(root, 'consumer-package.json'), join(root, 'package.json'));
    const fixtureTestPath = join(root, 'acceptance/calculator.test.ts');
    writeFileSync(fixtureTestPath, readFileSync(fixtureTestPath, 'utf8')
      .replace('// @fixture-use-case ', '// @use-case ')
      .replace('// @fixture-regression ', '// @regression '));
    execFileSync('git', ['init', '-q', root]);
    execFileSync('git', ['-C', root, 'config', 'user.name', 'Concord Test']);
    execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.invalid']);
    execFileSync('npm', [
      'install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline', '--no-save', '--package-lock=false',
      join(scratch, packed[0]!.filename), 'vitest@4.1.11'
    ], { cwd: root, encoding: 'utf8', timeout: 120_000 });
    execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], { cwd: root, encoding: 'utf8', timeout: 30_000 });
    const cli = join(root, 'node_modules/concord-sdlc/dist/entry.js');
    const commit = (message: string): string => {
      execFileSync('git', ['-C', root, 'add', '-A']);
      execFileSync('git', ['-C', root, 'commit', '-qm', message]);
      return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    };
    const call = (args: readonly string[], expectedStatus = 0) => {
      const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 60_000 });
      assert.equal(result.status, expectedStatus, `concord ${args.join(' ')}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
      return result;
    };
    const coreJson = <A>(args: readonly string[], schema: Schema.ConstraintDecoder<A, never>, expectedStatus = 0): A => {
      const result = call(['--root', root, '--json', ...args], expectedStatus);
      return json(result.stdout || result.stderr, schema);
    };
    const repoJson = <A>(args: readonly string[], schema: Schema.ConstraintDecoder<A, never>): A => {
      const result = call(['repo', ...args, '--json']);
      return json(result.stdout, schema);
    };

    const defectCommit = commit('defective calculator');
    coreJson(['memory', 'add', 'calculator', '--title', 'Calculator adds incorrectly', '--kind', 'problem'], Schema.Struct({ operation: Schema.String }));
    commit('record calculator problem');
    assert.match(readFileSync(join(root, 'memory/calculator.md'), 'utf8'), /evidenceRequirement: concord\.native-reliability\/v1/u);

    const listed = coreJson(['test', 'list'], CaseListSchema);
    const selected = listed.cases.find(item => item.file === 'acceptance/calculator.test.ts' && item.name === 'adds two numbers');
    assert.ok(selected);
    const selector = `acceptance/calculator.test.ts#${selected.id}`;
    const commandRed = coreJson(['test', 'run', selected.id], CommandEvidenceSchema, 1);
    assert.equal(commandRed.commandOutcome, 'fail');
    assert.notEqual(commandRed.exitCode, 0);
    assert.equal(commandRed.cleanupOk, true);

    writeFileSync(join(root, 'src/calculator.ts'), 'export function add(left: number, right: number): number {\n  return left + right;\n}\n');
    commit('fix calculator addition');
    const commandGreen = coreJson(['test', 'run', selected.id], CommandEvidenceSchema);
    assert.equal(commandGreen.commandOutcome, 'pass');
    assert.equal(commandGreen.exitCode, 0);
    assert.equal(commandGreen.cleanupOk, true);

    const bypass = coreJson([
      'memory', 'resolve', 'calculator', '--kind', 'fixed', '--reason', 'command evidence must not bypass native policy',
      '--red', commandRed.id, '--green', commandGreen.id
    ], CoreErrorSchema, 1);
    assert.equal(bypass.error, 'EvidenceRequirementUnsatisfied');
    assert.doesNotMatch(readFileSync(join(root, 'memory/calculator.md'), 'utf8'), /state: resolved/u);

    const inventory = repoJson(['docs', 'test', 'inventory', '--repo', 'calculator', '--checkout', 'HEAD'], InventoryResultSchema);
    assert.equal(inventory.caseCount, 1);
    execFileSync(process.execPath, ['--import', 'tsx', 'acceptance/record-evidence.ts', 'red', '0', defectCommit], { cwd: root, encoding: 'utf8', timeout: 60_000 });
    execFileSync(process.execPath, ['--import', 'tsx', 'acceptance/record-evidence.ts', 'takeover', '0'], { cwd: root, encoding: 'utf8', timeout: 120_000 });

    const takeover = Schema.decodeUnknownSync(TakeoverSchema)(JSON.parse(readFileSync(join(root, '.repo-tools/neutral-native/takeover.json'), 'utf8')) as unknown);
    assert.equal(takeover.receiptPaths.length, 7);
    const receipts = takeover.receiptPaths.map(path => Schema.decodeUnknownSync(ReceiptFactsSchema)(JSON.parse(readFileSync(join(root, path), 'utf8')) as unknown));
    const [green, isolatedA, isolatedB, isolatedC, sameA, sameB, parallel] = receipts;
    assert.equal(green?.observation, 'green');
    assert.equal(green?.native.mode, 'single');
    assert.equal(green?.native.caseCount, 1);
    assert.equal(green?.native.passed, 1);
    assert.deepEqual(receipts.map(item => [item.native.skipped, item.native.retries]), Array.from({ length: 7 }, () => [0, 0]));
    assert.equal(new Set([isolatedA?.native.copyId, isolatedB?.native.copyId, isolatedC?.native.copyId]).size, 3);
    assert.equal(new Set([isolatedA?.native.copyPath, isolatedB?.native.copyPath, isolatedC?.native.copyPath]).size, 3);
    assert.deepEqual([isolatedA?.native.mode, isolatedB?.native.mode, isolatedC?.native.mode], ['isolated', 'isolated', 'isolated']);
    assert.equal(sameA?.native.copyId, sameB?.native.copyId);
    assert.equal(sameA?.native.copyPath, sameB?.native.copyPath);
    assert.equal(sameB?.native.sequence, (sameA?.native.sequence ?? 0) + 1);
    assert.equal(parallel?.native.mode, 'parallel');
    assert.ok((parallel?.native.parallelism ?? 0) >= 2);
    assert.equal(new Set(receipts.map(item => item.invocationId)).size, 7);
    for (const receipt of receipts) {
      assert.equal(receipt.cleanup.ok, true);
      assert.equal(receipt.result.signal, null);
      assert.equal(receipt.result.timedOut, false);
      assert.equal(receipt.result.startupFailed, false);
      assert.ok(receipt.runner.argv.some(value => value.includes('vitest.mjs')));
      assert.ok(receipt.runner.argv.some(value => value.includes('reporter=json')));
      for (const resource of receipt.cleanup.resources) {
        assert.equal(resource.removed, true);
        assert.equal(existsSync(resource.path), false);
      }
    }
    const redReceipt = Schema.decodeUnknownSync(ReceiptFactsSchema)(JSON.parse(readFileSync(join(root, '.repo-tools/neutral-native/red.json'), 'utf8')) as unknown);
    assert.equal(redReceipt.observation, 'red');
    assert.equal(redReceipt.native.failed, 1);
    assert.equal(redReceipt.native.passed, 0);
    assert.notEqual(redReceipt.result.exitCode, 0);
    assert.equal(redReceipt.cleanup.ok, true);
    assert.equal(new Set([...receipts.map(item => item.invocationId), redReceipt.invocationId]).size, 8);

    repoJson([
      'docs', 'test', 'regression', 'add', selector,
      '--memory', 'memory/calculator.md', '--red', 'red-current', '--takeover', 'takeover-current', '--inventory', inventory.inventory
    ], Schema.Struct({ committed: Schema.Boolean }));
    const memoryBeforeFixed = readFileSync(join(root, 'memory/calculator.md'), 'utf8');
    assert.doesNotMatch(memoryBeforeFixed, /state: resolved/u);

    const declarationPath = join(root, 'acceptance/calculator.test.ts');
    const declaration = readFileSync(declarationPath, 'utf8');
    writeFileSync(declarationPath, `${declaration}\nexport const sourceDrift = true;\n`);
    const sourceDrift = call(['repo', 'memory', 'resolve', 'calculator', '--kind', 'fixed', '--reason', 'must reject source drift', '--json'], 1);
    assert.match(sourceDrift.stderr, /current source|source identity|Receipt does not bind/u);
    assert.doesNotMatch(readFileSync(join(root, 'memory/calculator.md'), 'utf8'), /state: resolved/u);
    writeFileSync(declarationPath, declaration);

    const configPath = join(root, 'concord.repository.json');
    const configuration = readFileSync(configPath, 'utf8');
    writeFileSync(configPath, `${configuration}\n`);
    const configDrift = call(['repo', 'memory', 'resolve', 'calculator', '--kind', 'fixed', '--reason', 'must reject config drift', '--json'], 1);
    assert.match(configDrift.stderr, /current source|source identity|Receipt does not bind/u);
    assert.doesNotMatch(readFileSync(join(root, 'memory/calculator.md'), 'utf8'), /state: resolved/u);
    writeFileSync(configPath, configuration);

    repoJson(['memory', 'resolve', 'calculator', '--kind', 'fixed', '--reason', 'native gate passed'], Schema.Struct({ operation: Schema.Literal('resolve'), memory: Schema.Struct({ state: Schema.Literal('resolved') }) }));
    const fixed = readFileSync(join(root, 'memory/calculator.md'), 'utf8');
    assert.match(fixed, /state: resolved/u);
    assert.match(fixed, /evidenceLevel: repository/u);
    assert.match(fixed, /policy: concord\.native-reliability\/v1/u);

    repoJson(['memory', 'reopen', 'calculator'], Schema.Struct({ operation: Schema.Literal('reopen'), memory: Schema.Struct({ state: Schema.Literal('open'), epoch: Schema.Literal(1) }) }));
    const reopened = readFileSync(join(root, 'memory/calculator.md'), 'utf8');
    assert.match(reopened, /state: open/u);
    assert.match(reopened, /epoch: 1/u);
    const oldEvidence = call(['repo', 'memory', 'resolve', 'calculator', '--kind', 'fixed', '--reason', 'old invocation must fail', '--json'], 1);
    assert.match(oldEvidence.stderr, /different Problem or epoch|invocation identities|already used/u);
    const stillOpen = readFileSync(join(root, 'memory/calculator.md'), 'utf8');
    assert.match(stillOpen, /state: open/u);
    assert.match(stillOpen, /epoch: 1/u);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
})));
