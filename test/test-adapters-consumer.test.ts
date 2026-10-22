import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { OwnedProcessLive, hasSuccessfulOwnedProcessResult, runOwnedProcess } from '../dist/owned-process.js';
import { ProjectSchema } from '../dist/shared.js';
import { renderTypeScriptConfig, parseTypeScriptConfig } from '../dist/config.js';
import { type TestAdapter } from '../dist/test-adapter-config.js';
import { LocalRepository } from '../dist/storage.js';
import { closeRepositoryCache, withPersistentCache } from '../dist/cache-store.js';
import { installConcord, packConcord } from './installed-package.js';

const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
const text = (root: string, path: string, value: string) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), value); };
const scratch = Effect.acquireRelease(Effect.sync(() => mkdtempSync(join(tmpdir(), 'concord-adapter-packed-'))), root => Effect.sync(() => rmSync(root, { recursive: true, force: true })));
const command = (argv: readonly string[], cwd: string) => runOwnedProcess(argv, { cwd, timeoutMs: 120_000, outputLimitBytes: 8 * 1024 * 1024 }).pipe(Effect.scoped, Effect.mapError(error => new Error(error.detail)));
const requireCommand = Effect.fn('adapterTest.command')(function* (argv: readonly string[], cwd: string) {
  const result = yield* command(argv, cwd); assert.ok(hasSuccessfulOwnedProcessResult(result), `${argv.join(' ')}\n${JSON.stringify(result)}`); return result;
});
const parse = (source: string): Record<string, unknown> => Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(JSON.parse(source));
const CaseList = Schema.Struct({ cases: Schema.Array(Schema.Struct({ id: Schema.String })) });
const Receipt = Schema.Struct({ id: Schema.String, scope: Schema.String, commandOutcome: Schema.String, definitionDigest: Schema.String, requested: Schema.optional(Schema.Array(Schema.String)), gaps: Schema.optional(Schema.Array(Schema.String)), commandExecutionCount: Schema.optional(Schema.Int), versions: Schema.optional(Schema.Struct({ framework: Schema.String, runtime: Schema.String })) });
const setup = Effect.fn('adapterTest.pack')(function* (root: string, needsEffect = false) {
  return yield* Effect.sync(() => {
    const packed = packConcord(root); const tool = join(root, 'tool');
    mkdirSync(tool); text(tool, 'package.json', JSON.stringify({ private: true, type: 'module' }));
    const fixtureDependencies: string[] = [];
    if (needsEffect) {
      const { dependencies } = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ dependencies: Schema.Struct({ effect: Schema.String }) })))(readFileSync(join(sourceRoot, 'package.json'), 'utf8'));
      // Only the external fixture imports Effect; framework consumers use package dependencies.
      fixtureDependencies.push(`effect@${dependencies.effect}`);
    }
    installConcord(tool, packed, ['vitest@4.1.11', ...fixtureDependencies]);
    return { cli: join(tool, 'node_modules/concord-sdlc/dist/entry.js'), tool };
  });
});
const prepare = Effect.fn('adapterTest.consumer')(function* (scratch: string, name: string, cli: string, tool: string) {
  const root = join(scratch, name); yield* Effect.sync(() => mkdirSync(root));
  yield* requireCommand(['git', 'init', '-q'], root);
  yield* requireCommand([process.execPath, cli, '--root', root, 'init', '--json'], root);
  yield* requireCommand([process.execPath, cli, '--root', root, 'feature', 'create', 'example', '--title', 'Example', '--json'], root);
  yield* Effect.sync(() => {
    text(root, 'package.json', '{"private":true,"type":"module"}');
    symlinkSync(join(tool, 'node_modules'), join(root, 'node_modules'), 'dir');
    text(root, '.gitignore', 'node_modules\n**/target/\n**/__pycache__/\n**/.pytest_cache/\n');
  });
  return root;
});
const configure = (root: string, adapters: readonly TestAdapter[], sourceIgnore: readonly string[] = []) => {
  const config = parseTypeScriptConfig(readFileSync(join(root, 'concord.config.ts'), 'utf8'));
  writeFileSync(join(root, 'concord.config.ts'), renderTypeScriptConfig(Schema.decodeUnknownSync(ProjectSchema)({ ...config, testAdapters: adapters, sourceIgnore })));
};
const call = (root: string, cli: string, args: readonly string[]) => command([process.execPath, cli, '--root', root, '--json', ...args], root);
const success = Effect.fn('adapterTest.cli')(function* (root: string, cli: string, args: readonly string[]) {
  const result = yield* call(root, cli, args); assert.equal(result.exitCode, 0, `${args.join(' ')}\n${result.stderr}\n${result.stdout}`); return result;
});
const idFor = Effect.fn('adapterTest.id')(function* (root: string, cli: string) {
  const list = yield* success(root, cli, ['test', 'list']); return Schema.decodeUnknownSync(CaseList)(JSON.parse(list.stdout)).cases[0]!.id;
});
const environment = ['NODE_OPTIONS', 'PATH', 'HOME', 'UV_CACHE_DIR', 'UV_PYTHON_INSTALL_DIR', 'GOCACHE', 'GOPATH', 'CARGO_HOME', 'RUSTUP_HOME', 'RUSTUP_TOOLCHAIN', 'RUSTUP_AUTO_INSTALL', 'RUSTFLAGS', 'NIX_LD', 'NIX_LD_LIBRARY_PATH'];
const builtin = (id: string, include: string, name: TestAdapter['builtin'], version: string, inputRoots: readonly string[] = []): TestAdapter => ({ id, include: [include], builtin: name, frameworkVersion: version, implementationFiles: [], inputRoots, lockFiles: [], envNames: environment });

// @use-case docs/feature/local-sdlc/use-case/run-native-test-adapters.md
// @name packed-real-adapter-frameworks-c18
test('packed adapters collect and select real Vitest pytest Go Cargo and report Node capability gaps (C2 C4 C6 C13 C17 C18)', { skip: process.platform !== 'linux' && 'Native report directory-handle traversal is not verified on this platform' }, t => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const root = yield* scratch; const { cli, tool } = yield* setup(root);
  const specifications = [
    { name: 'vitest', file: 'test/example.test.ts', adapter: builtin('vt', 'test', 'vitest', '4.1.11'), source: `import { test, expect } from 'vitest';\n// @feature docs/feature/example/README.md\n// @native vitest:vt:default:test/example.test.ts:selected\ntest('selected', () => expect(1).toBe(1));\ntest('excluded', () => { throw new Error('must not execute'); });\ntest.skip('skipped', () => {});\n` },
    { name: 'pytest', file: 'test/test_example.py', adapter: builtin('py', 'test', 'pytest', '9.1.1'), source: `# @feature docs/feature/example/README.md\n# @native pytest:py:default:test/test_example.py::test_selected\ndef test_selected():\n    assert True\ndef test_excluded():\n    assert False\n` },
    { name: 'go', file: 'test/example_test.go', adapter: builtin('go', 'test', 'go', 'go1.26.7'), source: `package example\nimport "testing"\n// @feature docs/feature/example/README.md\n// @native go:go:test:test/example_test.go:TestSelected\nfunc TestSelected(t *testing.T) {}\nfunc TestExcluded(t *testing.T) { t.Fatal("must not execute") }\n` },
    { name: 'cargo', file: 'test/src/lib.rs', adapter: builtin('rs', 'test', 'cargo', '1.97.1', ['test/src']), source: `// @feature docs/feature/example/README.md\n// @native cargo:rs:test:lib:test/src/lib.rs:selected\n#[test]\nfn selected() {}\n#[test]\nfn excluded() { panic!("must not execute"); }\n` },
    { name: 'node', file: 'test/example.test.ts', adapter: builtin('node', 'test', 'node-test', process.versions.node), source: `import { test } from 'node:test';\n// @feature docs/feature/example/README.md\ntest('selected', () => {});\n` },
  ];
  for (const spec of specifications) {
    const probe = spec.name === 'pytest' ? ['uv', 'run', '--offline', '--no-project', '--with', 'pytest==9.1.1', 'pytest', '--version'] : spec.name === 'go' ? ['go', 'version'] : spec.name === 'cargo' ? ['cargo', '+stable', '--version'] : [process.execPath, '--version'];
    const available = yield* command(probe, root);
    if (!hasSuccessfulOwnedProcessResult(available)) {
      assert.notEqual(process.env.CI, 'true', `${spec.name} must be available in CI: ${available.stderr || available.error}`);
      yield* Effect.promise(() => t.test(`${spec.name} unavailable`, { skip: `${probe.join(' ')} unavailable: ${available.stderr || available.error}` }, () => Effect.runPromise(Effect.void))); continue;
    }
    // Cargo's explicit +stable selector follows the installed stable toolchain.
    // Pin the consumer to that observed version, not the developer machine's version.
    const adapter = spec.name === 'cargo'
      ? { ...spec.adapter, frameworkVersion: /^cargo (\d+\.\d+\.\d+)\b/u.exec(available.stdout)?.[1] ?? '' }
      : spec.adapter;
    assert.notEqual(adapter.frameworkVersion, '', 'the installed framework version must be identifiable');
    const consumer = yield* prepare(root, spec.name, cli, tool);
    yield* Effect.sync(() => {
      text(consumer, spec.file, spec.source);
      if (spec.name === 'go') text(consumer, 'test/go.mod', 'module example.test/adapter\n\ngo 1.26.0\n');
      if (spec.name === 'cargo') { text(consumer, 'test/Cargo.toml', '[package]\nname="adapter-fixture"\nversion="0.1.0"\nedition="2024"\n'); text(consumer, 'test/Cargo.lock', 'version = 4\n[[package]]\nname = "adapter-fixture"\nversion = "0.1.0"\n'); }
      configure(consumer, [adapter], ['test/target']);
    });
    if (spec.name === 'cargo') {
      // Probe compilation as well as cargo itself: an installed rustup proxy does
      // not establish that the stable compiler and system linker are usable.
      const compiled = yield* command(['cargo', '+stable', 'test', '--offline', '--manifest-path', 'test/Cargo.toml', '--no-run'], consumer);
      if (!hasSuccessfulOwnedProcessResult(compiled)) {
        assert.notEqual(process.env.CI, 'true', `Cargo compilation must succeed in CI: ${compiled.stderr || compiled.error}`);
        yield* Effect.promise(() => t.test('cargo compiler/linker unavailable', { skip: compiled.stderr || compiled.error }, () => Effect.runPromise(Effect.void))); continue;
      }
    }
    const collected = yield* success(consumer, cli, ['test', 'collect', spec.file]);
    t.diagnostic(`${spec.name}: collection completed; ${available.stdout.trim()}`);
    const native = parse(collected.stdout); assert.ok(native.observations);
    const collectedState = Schema.decodeUnknownSync(Schema.Struct({ observations: Schema.Array(Schema.Struct({ observation: Schema.Struct({ complete: Schema.Boolean, gaps: Schema.Array(Schema.String) }), inputScope: Schema.Struct({ members: Schema.Array(Schema.Unknown), excluded: Schema.Array(Schema.String), versions: Schema.Struct({ framework: Schema.String, runtime: Schema.String, observedFramework: Schema.String, observedRuntime: Schema.optional(Schema.String) }) }) })) }))(JSON.parse(collected.stdout)).observations[0]!;
    assert.equal(collectedState.observation.complete, false); assert.ok(collectedState.observation.gaps.includes('ExternalInputUnknown')); assert.equal(collectedState.inputScope.versions.framework, adapter.frameworkVersion);
    const id = yield* idFor(consumer, cli);
    const executed = yield* call(consumer, cli, ['test', 'run', id, '--require-native']);
    if (spec.name === 'node') {
      assert.equal(executed.exitCode, 1); assert.match(executed.stderr, /NativeSelectionUnsupported/);
      const fallback = Schema.decodeUnknownSync(Receipt)(JSON.parse((yield* success(consumer, cli, ['test', 'run', id])).stdout));
      assert.equal(fallback.scope, 'command'); assert.equal(fallback.commandOutcome, 'pass');
    }
    else { assert.equal(executed.exitCode, 0, `${spec.name}\n${executed.stderr}\n${executed.stdout}`); const receipt = Schema.decodeUnknownSync(Receipt)(JSON.parse(executed.stdout)); assert.equal(receipt.scope, 'native'); assert.equal(receipt.commandOutcome, 'green'); assert.equal(receipt.requested?.length, 1); assert.ok(receipt.gaps?.includes('ExternalInputUnknown')); assert.equal(receipt.versions?.framework, adapter.frameworkVersion); }
    if (spec.name === 'cargo') {
      yield* Effect.sync(() => text(consumer, 'test/tests/other.rs', '// @feature docs/feature/example/README.md\n// @native cargo:rs:test:test:other:test/tests/other.rs:selected\n#[test]\nfn selected() {}\n#[test]\nfn excluded() { panic!("must not execute"); }\n'));
      const multiple = yield* success(consumer, cli, ['test', 'collect', spec.file, 'test/tests/other.rs']);
      const inventory = Schema.decodeUnknownSync(Schema.Struct({ observations: Schema.Array(Schema.Struct({ observation: Schema.Struct({ value: Schema.Struct({ cases: Schema.Array(Schema.Struct({ nativeId: Schema.String })) }) }) })) }))(JSON.parse(multiple.stdout));
      const nativeIds = inventory.observations.flatMap(item => item.observation.value.cases.map(item => item.nativeId));
      assert.equal(new Set(nativeIds).size, nativeIds.length); assert.ok(nativeIds.some(id => id.includes(':lib:'))); assert.ok(nativeIds.some(id => id.includes(':test:other:')));
      const list = Schema.decodeUnknownSync(CaseList)(JSON.parse((yield* success(consumer, cli, ['test', 'list'])).stdout));
      for (const item of list.cases) {
        const run = Schema.decodeUnknownSync(Receipt)(JSON.parse((yield* success(consumer, cli, ['test', 'run', item.id, '--require-native'])).stdout));
        assert.equal(run.commandOutcome, 'green'); assert.equal(run.requested?.length, 1);
      }
    }
    if (spec.name === 'go') {
      yield* Effect.sync(() => text(consumer, spec.file, 'package example\nimport "testing"\n// @feature docs/feature/example/README.md\n// @native go:go:test:test/example_test.go:TestDynamic\nfunc TestDynamic(t *testing.T) { t.Run("child", func(t *testing.T) {}) }\n'));
      const dynamicId = yield* idFor(consumer, cli);
      const dynamic = yield* call(consumer, cli, ['test', 'run', dynamicId, '--require-native']);
      const receipt = Schema.decodeUnknownSync(Receipt)(JSON.parse(dynamic.stdout));
      assert.equal(dynamic.exitCode, 1); assert.equal(receipt.commandOutcome, 'invalid'); assert.equal(receipt.requested?.length, 1);
    }
  }
})).pipe(Effect.provide(OwnedProcessLive))));

// @use-case docs/feature/local-sdlc/use-case/run-native-test-adapters.md
// @name packed-external-adapter-boundaries
test('packed external adapter preserves static relations and rejects dishonest protocol/report outcomes (C1-C5 C7-C16)', { skip: process.platform !== 'linux' && 'Native report directory-handle traversal is not verified on this platform' }, () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const root = yield* scratch; const { cli, tool } = yield* setup(root, true);
  const consumer = yield* prepare(root, 'external', cli, tool);
  yield* Effect.sync(() => {
    copyFileSync(join(sourceRoot, 'test/fixtures/process-adapter.ts'), join(consumer, 'adapter.ts'));
    text(consumer, 'fixture.txt', 'original'); text(consumer, 'fixture.lock', 'locked'); text(consumer, 'mode.txt', 'green');
    text(consumer, 'test/sample.ts', '// @feature docs/feature/example/README.md\n// @name parameter-group\n// @regression memory/problem.md\n');
    configure(consumer, [{ id: 'external', include: ['test'], argv: [process.execPath, 'adapter.ts'], implementationFiles: ['adapter.ts'], inputRoots: [], frameworkVersion: 'fixture/v1', lockFiles: ['fixture.lock'], envNames: ['NODE_OPTIONS', 'PATH'], collectTimeoutMs: 1000, budgets: { reportFileBytes: 128 } }]);
  });
  yield* success(consumer, cli, ['memory', 'add', 'problem', '--kind', 'problem', '--title', 'Problem']);
  const id = yield* idFor(consumer, cli);
  const checkBefore = yield* success(consumer, cli, ['check']);
  const coldCases = Schema.decodeUnknownSync(CaseList)(JSON.parse((yield* success(consumer, cli, ['test', 'list'])).stdout)).cases;
  yield* success(consumer, cli, ['test', 'collect']);
  const checkAfter = yield* success(consumer, cli, ['check']);
  const before = parse(checkBefore.stdout), after = parse(checkAfter.stdout);
  for (const field of ['ok', 'complete', 'findings', 'cases']) assert.deepEqual(after[field], before[field]);
  const corruptObservation = () => {
    const repo = new LocalRepository(consumer);
    try { repo.snapshot(() => withPersistentCache(repo, true, db => db!.put('annotation_cache', [{ key: 'native-manifest/v1/external', payload: '{broken' }]))); }
    finally { closeRepositoryCache(repo); repo.close(); }
  };
  for (const state of ['warm', 'corrupt', 'clear']) {
    if (state === 'corrupt') yield* Effect.sync(corruptObservation);
    if (state === 'clear') yield* success(consumer, cli, ['cache', 'clear']);
    const checked = parse((yield* success(consumer, cli, ['check'])).stdout);
    for (const field of ['ok', 'complete', 'findings']) assert.deepEqual(checked[field], before[field], state);
    assert.deepEqual(Schema.decodeUnknownSync(CaseList)(JSON.parse((yield* success(consumer, cli, ['test', 'list'])).stdout)).cases, coldCases, state);
  }
  const markedSource = readFileSync(join(consumer, 'test/sample.ts'), 'utf8');
  yield* Effect.sync(() => text(consumer, 'test/sample.ts', markedSource.replace('docs/feature/example/README.md', 'docs/feature/missing/README.md')));
  let wrongSource: unknown;
  for (const state of ['cold', 'warm', 'corrupt', 'clear']) {
    if (state === 'warm') yield* success(consumer, cli, ['test', 'collect']);
    if (state === 'corrupt') yield* Effect.sync(corruptObservation);
    if (state === 'clear') yield* success(consumer, cli, ['cache', 'clear']);
    const checked = yield* call(consumer, cli, ['check']); assert.equal(checked.exitCode, 1);
    const result = parse(checked.stdout); const stable = { ok: result.ok, complete: result.complete, findings: result.findings };
    if (wrongSource === undefined) wrongSource = stable; else assert.deepEqual(stable, wrongSource, state);
    assert.ok(Array.isArray(result.findings) && result.findings.length > 0);
  }
  yield* Effect.sync(() => text(consumer, 'test/sample.ts', markedSource));
  yield* success(consumer, cli, ['test', 'collect']);
  const observationState = (source: string) => Schema.decodeUnknownSync(Schema.Struct({ observations: Schema.Array(Schema.Struct({ observation: Schema.Struct({ current: Schema.Boolean, inputs: Schema.String }) })) }))(JSON.parse(source)).observations[0]!.observation;
  const scriptBefore = observationState((yield* success(consumer, cli, ['test', 'list'])).stdout);
  yield* Effect.sync(() => text(consumer, 'adapter.ts', readFileSync(join(consumer, 'adapter.ts'), 'utf8') + '\n// implementation changed\n'));
  assert.equal(observationState((yield* success(consumer, cli, ['test', 'list'])).stdout).current, false);
  yield* success(consumer, cli, ['test', 'collect']);
  const scriptAfter = observationState((yield* success(consumer, cli, ['test', 'list'])).stdout);
  assert.equal(scriptAfter.current, true); assert.notEqual(scriptBefore.inputs, scriptAfter.inputs);
  for (const mode of ['green', 'split', 'missing', 'duplicate', 'extra', 'skip', 'parser-failed', 'symlink', 'unexpected-report', 'large-report']) {
    yield* Effect.sync(() => text(consumer, 'mode.txt', mode));
    const run = yield* call(consumer, cli, ['test', 'run', id, '--require-native']);
    const receipt = Schema.decodeUnknownSync(Receipt)(JSON.parse(run.stdout));
    assert.equal(receipt.commandOutcome, ['green', 'split'].includes(mode) ? 'green' : 'invalid', `${mode}: ${run.stderr}\n${run.stdout}`);
    assert.equal(receipt.requested?.length, 2);
    if (mode === 'split') assert.equal(receipt.commandExecutionCount, 2);
  }
  for (const mode of ['wrong-echo', 'extra-envelope', 'duplicate-key', 'nonfinite', 'timeout', 'escape-report', 'drift', 'drift-config', 'drift-lock', 'drift-member']) {
    yield* Effect.sync(() => text(consumer, 'mode.txt', mode));
    const run = yield* call(consumer, cli, ['test', 'run', id, '--require-native']);
    assert.equal(run.exitCode, 1, mode); assert.match(run.stderr, /AdapterProtocolInvalid|ReportUnsafe|InputChanged/, mode);
  }
  yield* Effect.sync(() => { text(consumer, 'mode.txt', 'red'); text(consumer, 'fixture.txt', 'original'); });
  const red = Schema.decodeUnknownSync(Receipt)(JSON.parse((yield* call(consumer, cli, ['test', 'run', id, '--require-native'])).stdout)); assert.equal(red.commandOutcome, 'red');
  yield* Effect.sync(() => text(consumer, 'mode.txt', 'green'));
  const green = Schema.decodeUnknownSync(Receipt)(JSON.parse((yield* success(consumer, cli, ['test', 'run', id, '--require-native'])).stdout));
  assert.notEqual(red.definitionDigest, green.definitionDigest); assert.deepEqual(red.requested, green.requested); assert.ok(green.gaps?.includes('ExternalInputUnknown'));
  yield* success(consumer, cli, ['memory', 'resolve', 'problem', '--kind', 'fixed', '--reason', 'Native red and green', '--red', red.id, '--green', green.id]);
  yield* success(consumer, cli, ['cache', 'clear']);
  assert.equal(yield* idFor(consumer, cli), id);
})).pipe(Effect.provide(OwnedProcessLive))));
