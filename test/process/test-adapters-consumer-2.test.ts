import { RuntimeEnvironment, makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { sourceCli, assert, existsSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, join, tmpdir, fileURLToPath, test, Effect, Schema, OwnedProcessLive, hasSuccessfulOwnedProcessResult, runOwnedProcess, ProjectSchema, renderTypeScriptConfig, parseTypeScriptConfig, type TestAdapter, LocalRepository, closeRepositoryCache, withPersistentCache, prepareSourceConsumer, sourceRoot, text, scratch, command, requireCommand, parse, CaseList, Receipt, setup, prepare, configure, call, success, idFor, environment, builtin } from '../support/test-adapters-consumer-fixture.ts';


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
    const adapter = spec.name === 'go'
      ? { ...spec.adapter, frameworkVersion: /^go version (go\d+\.\d+\.\d+)\b/u.exec(available.stdout)?.[1] ?? '' }
      : spec.name === 'cargo'
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
    const collected = yield* success(consumer, cli, ['test', 'discover', spec.file]);
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
      const multiple = yield* success(consumer, cli, ['test', 'discover', spec.file, 'test/tests/other.rs']);
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
})).pipe(Effect.provide(OwnedProcessLive), Effect.provideService(RuntimeEnvironment, makeRuntimeEnvironment(process.cwd(), process.env)))));
