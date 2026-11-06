import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { constants, homedir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { Schema } from 'effect';
import { InitializationReceiptSchema, RunnerSchema } from '../../src/model/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { runCli, type CliResult } from '../support/cli.ts';
import { readProjectConfig } from '../support/support.ts';
import { tmpdir } from '../support/temporary.ts';

const ErrorOutput = Schema.Struct({ ok: Schema.Literal(false), error: Schema.String, message: Schema.String, details: Schema.optional(Schema.Unknown) });
const HerdrOutput = Schema.Struct({ operation: Schema.Literal('herdr-uninstall'), path: Schema.String, dryRun: Schema.Literal(true), absent: Schema.Literal(true) });
const decodeError = Schema.decodeUnknownSync(Schema.fromJsonString(ErrorOutput), { onExcessProperty: 'error' });
const decodeHerdr = Schema.decodeUnknownSync(Schema.fromJsonString(HerdrOutput), { onExcessProperty: 'error' });

function consumer(t: TestContext): string {
  const root = createConsumer();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

const environment = (root: string): NodeJS.ProcessEnv => ({ ...process.env, HOME: root, USERPROFILE: root, HERDR_APP_HOME: join(root, 'herdr'), XDG_CACHE_HOME: process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), NO_COLOR: '1', TERM: 'dumb', FORCE_COLOR: undefined });

/** Compare hashes so a failing isolation assertion cannot print host secrets. */
function hostGuard(): () => void {
  const env = process.env, stdin = process.stdin, stdout = process.stdout, stderr = process.stderr;
  const snapshot = () => ({
    cwd: process.cwd(), exitCode: process.exitCode,
    env: createHash('sha256').update(JSON.stringify(Object.entries(process.env).sort(([left], [right]) => left.localeCompare(right)))).digest('hex'),
    signals: Object.fromEntries(Object.keys(constants.signals).map(name => [name, process.rawListeners(name)])),
  });
  const before = snapshot();
  return () => {
    assert.equal(process.env === env, true, 'host environment object is preserved');
    assert.equal(process.stdin === stdin && process.stdout === stdout && process.stderr === stderr, true, 'host standard stream references are preserved');
    assert.deepEqual(snapshot(), before, 'CLI invocation must not change its host');
  };
}

function success(result: CliResult): void {
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, '');
}

/** A failed caller must finish alongside its peers before fixture cleanup. */
async function concurrent(invocations: readonly Promise<CliResult>[]): Promise<CliResult[]> {
  const outcomes = await Promise.allSettled(invocations);
  const failures = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason] : []);
  if (failures.length !== 0) throw new AggregateError(failures, 'Concurrent CLI invocation failed');
  return outcomes.map(outcome => { assert.ok(outcome.status === 'fulfilled'); return outcome.value; });
}

// @feature docs/engineering/testing/architecture.md#进程内-cli
test('A, failing B, and A keep exact output and reset the invocation exit code', async t => {
  const firstRoot = consumer(t), secondRoot = consumer(t);
  const unchanged = hostGuard();
  try {
    const argv = ['--json', 'template', 'show', 'feature', '--title', '隔离 A 🧭'];
    const first = await runCli({ argv, cwd: firstRoot, env: environment(firstRoot) });
    success(first);
    const failed = await runCli({ argv: ['--json', 'init', '--docs-only', '--test-root', 'test'], cwd: secondRoot, env: environment(secondRoot) });
    assert.equal(failed.exitCode, 1);
    assert.equal(failed.stdout, '');
    assert.equal(decodeError(failed.stderr).error, 'ConflictingOptions');
    const repeated = await runCli({ argv, cwd: firstRoot, env: environment(firstRoot) });
    assert.deepEqual(repeated, first);
    assert.equal(repeated.exitCode, 0);
  } finally { unchanged(); }
});

// @feature docs/engineering/testing/architecture.md#进程内-cli
test('concurrent callers own UTF-8 byte stdin, string stdin and EOF through real document writes', async t => {
  const roots = [consumer(t), consumer(t)];
  const bodies = ['# 输入甲 🧭\n\n来自字节 stdin。\n', '# 输入乙 🌿\n\n来自字符串 stdin。\n'];
  const unchanged = hostGuard();
  try {
    const results = await concurrent(roots.map((cwd, index) => runCli({
      argv: ['--json', 'new', 'feature', 'same-name', '--body', '-'], cwd, env: environment(cwd),
      stdin: index === 0 ? new Uint8Array(Buffer.from(bodies[index]!, 'utf8')) : bodies[index],
    })));
    results.forEach(success);
    roots.forEach((root, index) => {
      assert.equal(readFileSync(join(root, 'docs/feature/same-name/README.md'), 'utf8'), bodies[index]);
      assert.equal(existsSync(join(root, '.git/concord/server/current.json')), false, 'local writes do not require a workspace service');
    });
  } finally { unchanged(); }
});

// @feature docs/engineering/testing/architecture.md#进程内-cli
test('the same relative body filename resolves against each concurrent invocation cwd', async t => {
  const roots = [consumer(t), consumer(t)];
  const bodies = ['# 相对甲\n\n甲的正文。\n', '# 相对乙\n\n乙的正文。\n'];
  roots.forEach((root, index) => writeFileSync(join(root, 'invocation-body.md'), bodies[index]!));
  const unchanged = hostGuard();
  try {
    const results = await concurrent(roots.map(cwd => runCli({ argv: ['--json', 'new', 'feature', 'relative', '--body', 'invocation-body.md'], cwd, env: environment(cwd) })));
    results.forEach(success);
    roots.forEach((root, index) => assert.equal(readFileSync(join(root, 'docs/feature/relative/README.md'), 'utf8'), bodies[index]));
  } finally { unchanged(); }
});

// @feature docs/engineering/testing/architecture.md#进程内-cli
test('concurrent environment snapshots choose their own paths and never fill absent HOME from the host', async t => {
  const firstRoot = consumer(t), secondRoot = consumer(t);
  const firstEnv = environment(firstRoot), secondEnv = environment(secondRoot);
  delete secondEnv.HOME;
  delete secondEnv.HERDR_APP_HOME;
  const unchanged = hostGuard();
  try {
    const argv = ['--json', '--dry-run', 'herdr', 'uninstall'];
    const results = await concurrent([
      runCli({ argv, cwd: firstRoot, env: firstEnv }),
      runCli({ argv, cwd: secondRoot, env: secondEnv }),
    ]);
    results.forEach(success);
    assert.equal(decodeHerdr(results[0]!.stdout).path, join(firstRoot, 'herdr/mods/concord'));
    assert.equal(decodeHerdr(results[1]!.stdout).path, join(secondRoot, '.config/herdr-app/mods/concord'));
    assert.equal(existsSync(join(firstRoot, 'herdr')), false);
    assert.equal(existsSync(join(secondRoot, '.config')), false);
  } finally { unchanged(); }
});

// @feature docs/engineering/testing/architecture.md#进程内-cli
test('init reads relative runner JSON from its invocation cwd without a TTY prompt', async t => {
  // Init observes the initial state itself, so its consumer must start uninitialized.
  const root = mkdtempSync(join(tmpdir(), 'concord-invocation-init-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', root]);
  const runner = { kind: 'node-test' as const, sourceFiles: [], timeoutMs: 1000 };
  writeFileSync(join(root, 'invocation-runner.json'), Schema.encodeSync(Schema.fromJsonString(RunnerSchema))(runner));
  const unchanged = hostGuard();
  try {
    const result = await runCli({ argv: ['--json', 'init', '--docs-only', '--runner-config', 'invocation-runner.json'], cwd: root, env: environment(root) });
    success(result);
    Schema.decodeUnknownSync(Schema.fromJsonString(InitializationReceiptSchema), { onExcessProperty: 'error' })(result.stdout);
    assert.deepEqual(readProjectConfig(root).runner, runner);
  } finally { unchanged(); }
});

// @feature docs/engineering/testing/architecture.md#进程内-cli
test('human and JSON help and argument failures use only the current invocation streams', async t => {
  const root = consumer(t);
  const unchanged = hostGuard();
  try {
    for (const json of [false, true]) {
      await t.test(json ? 'JSON' : 'human', async () => {
        const prefix = json ? ['--json'] : [];
        const help = await runCli({ argv: [...prefix, '--help'], cwd: root, env: environment(root) });
        success(help);
        assert.match(help.stdout, /concord/u);
        assert.match(help.stdout, /--root/u);
        const failed = await runCli({ argv: [...prefix, 'template', 'show'], cwd: root, env: environment(root) });
        assert.equal(failed.exitCode, 1);
        if (json) {
          assert.equal(failed.stdout, '');
          assert.equal(decodeError(failed.stderr).error, 'InvalidInput');
        } else assert.match(failed.stdout + failed.stderr, /name/u);
      });
    }
  } finally { unchanged(); }
});
