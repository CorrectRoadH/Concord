// 跨进程保证：外部程序——真实pytest、Go和Cargo收集不派发测试体。
import { RuntimeEnvironment, makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { assert, test, Effect, Schema, OwnedProcessLive, hasSuccessfulOwnedProcessResult, text, scratch, command, parse, setup, configure, builtin } from '../support/test-adapters-consumer-fixture.ts';
import { prepare, success } from '../support/adapter-runtime-cli.ts';


// @use-case docs/feature/local-sdlc/use-case/collect-native-tests.md
// @name packed-real-adapter-frameworks-c18
test('packed adapters collect real pytest Go and Cargo without dispatching test bodies (C2 C4 C6 C13 C17 C18)', { skip: process.platform !== 'linux' && 'Native report directory-handle traversal is not verified on this platform' }, t => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const root = yield* scratch; const { tool } = yield* setup(root);
  const specifications = [
    { name: 'pytest', file: 'test/test_example.py', adapter: builtin('py', 'test', 'pytest', '9.2.0'), source: `# @feature docs/feature/example/README.md\n# @native pytest:py:default:test/test_example.py::test_selected\ndef test_selected():\n    raise AssertionError("must not execute")\ndef test_excluded():\n    assert False\n` },
    { name: 'go', file: 'test/example_test.go', adapter: builtin('go', 'test', 'go', 'go1.27.3'), source: `package example\nimport "testing"\n// @feature docs/feature/example/README.md\n// @native go:go:test:test/example_test.go:TestSelected\nfunc TestSelected(t *testing.T) { t.Fatal("must not execute") }\nfunc TestExcluded(t *testing.T) { t.Fatal("must not execute") }\n` },
    { name: 'cargo', file: 'test/src/lib.rs', adapter: builtin('rs', 'test', 'cargo', '1.97.1', ['test/src']), source: `// @feature docs/feature/example/README.md\n// @native cargo:rs:test:lib:test/src/lib.rs:selected\n#[test]\nfn selected() { panic!("must not execute"); }\n#[test]\nfn excluded() { panic!("must not execute"); }\n` },
  ];
  for (const spec of specifications) yield* Effect.scoped(Effect.gen(function* () {
    const probe = spec.name === 'pytest' ? ['uv', 'run', '--offline', '--no-project', '--with', 'pytest==9.2.0', 'pytest', '--version'] : spec.name === 'go' ? ['go', 'version'] : ['cargo', '+stable', '--version'];
    const available = yield* command(probe, root);
    if (!hasSuccessfulOwnedProcessResult(available)) {
      assert.notEqual(process.env.CI, 'true', `${spec.name} must be available in CI: ${available.stderr || available.error}`);
      t.diagnostic(`${spec.name} unavailable: ${available.stderr || available.error}`);
      yield* Effect.promise(() => t.test(`${spec.name} unavailable`, { skip: `${probe.join(' ')} unavailable: ${available.stderr || available.error}` }, () => Effect.runPromise(Effect.void))); return;
    }
    // Cargo's explicit +stable selector follows the installed stable toolchain.
    // Pin the consumer to that observed version, not the developer machine's version.
    const adapter = spec.name === 'go'
      ? { ...spec.adapter, frameworkVersion: /^go version (go\d+\.\d+\.\d+)\b/u.exec(available.stdout)?.[1] ?? '' }
      : spec.name === 'cargo'
      ? { ...spec.adapter, frameworkVersion: /^cargo (\d+\.\d+\.\d+)\b/u.exec(available.stdout)?.[1] ?? '' }
      : spec.adapter;
    assert.notEqual(adapter.frameworkVersion, '', 'the installed framework version must be identifiable');
    const consumer = yield* prepare(root, spec.name, tool);
    yield* Effect.tryPromise(async () => {
      text(consumer, spec.file, spec.source);
      if (spec.name === 'go') text(consumer, 'test/go.mod', 'module example.test/adapter\n\ngo 1.26.0\n');
      if (spec.name === 'cargo') { text(consumer, 'test/Cargo.toml', '[package]\nname="adapter-fixture"\nversion="0.1.0"\nedition="2024"\n'); text(consumer, 'test/Cargo.lock', 'version = 4\n[[package]]\nname = "adapter-fixture"\nversion = "0.1.0"\n'); }
      (await configure(consumer, [adapter], ['test/target']));
    });
    if (spec.name === 'cargo') {
      // Probe compilation as well as cargo itself: an installed rustup proxy does
      // not establish that the stable compiler and system linker are usable.
      const compiled = yield* command(['cargo', '+stable', 'test', '--offline', '--manifest-path', 'test/Cargo.toml', '--no-run'], consumer);
      if (!hasSuccessfulOwnedProcessResult(compiled)) {
        assert.notEqual(process.env.CI, 'true', `Cargo compilation must succeed in CI: ${compiled.stderr || compiled.error}`);
        t.diagnostic(`cargo compiler/linker unavailable: ${compiled.stderr || compiled.error}`);
        yield* Effect.promise(() => t.test('cargo compiler/linker unavailable', { skip: compiled.stderr || compiled.error }, () => Effect.runPromise(Effect.void))); return;
      }
    }
    const collected = yield* success(consumer, ['test', 'discover', spec.file]);
    t.diagnostic(`${spec.name}: collection completed; ${available.stdout.trim()}`);
    const native = parse(collected.stdout); assert.ok(native.observations);
    const collectedState = Schema.decodeUnknownSync(Schema.Struct({ observations: Schema.Array(Schema.Struct({ observation: Schema.Struct({ complete: Schema.Boolean, gaps: Schema.Array(Schema.String) }), inputScope: Schema.Struct({ members: Schema.Array(Schema.Unknown), excluded: Schema.Array(Schema.String), versions: Schema.Struct({ framework: Schema.String, runtime: Schema.String, observedFramework: Schema.String, observedRuntime: Schema.optional(Schema.String) }) }) })) }))(JSON.parse(collected.stdout)).observations[0]!;
    assert.equal(collectedState.observation.complete, false); assert.ok(collectedState.observation.gaps.includes('ExternalInputUnknown')); assert.equal(collectedState.inputScope.versions.framework, adapter.frameworkVersion);
    if (spec.name === 'cargo') {
      yield* Effect.sync(() => text(consumer, 'test/tests/other.rs', '// @feature docs/feature/example/README.md\n// @native cargo:rs:test:test:other:test/tests/other.rs:selected\n#[test]\nfn selected() { panic!("must not execute"); }\n#[test]\nfn excluded() { panic!("must not execute"); }\n'));
      const multiple = yield* success(consumer, ['test', 'discover', spec.file, 'test/tests/other.rs']);
      const inventory = Schema.decodeUnknownSync(Schema.Struct({ observations: Schema.Array(Schema.Struct({ observation: Schema.Struct({ value: Schema.Struct({ cases: Schema.Array(Schema.Struct({ nativeId: Schema.String })) }) }) })) }))(JSON.parse(multiple.stdout));
      const nativeIds = inventory.observations.flatMap(item => item.observation.value.cases.map(item => item.nativeId));
      assert.equal(new Set(nativeIds).size, nativeIds.length); assert.ok(nativeIds.some(id => id.includes(':lib:'))); assert.ok(nativeIds.some(id => id.includes(':test:other:')));

    }
    if (spec.name === 'go') {
      yield* Effect.sync(() => text(consumer, spec.file, 'package example\nimport "testing"\n// @feature docs/feature/example/README.md\n// @native go:go:test:test/example_test.go:TestDynamic\nfunc TestDynamic(t *testing.T) { t.Run("child", func(t *testing.T) {}) }\n'));
      const dynamic = yield* success(consumer, ['test', 'discover', spec.file]);
      const inventory = Schema.decodeUnknownSync(Schema.Struct({ observations: Schema.Array(Schema.Struct({ observation: Schema.Struct({ value: Schema.Struct({ cases: Schema.Array(Schema.Struct({ nativeId: Schema.String })) }), gaps: Schema.Array(Schema.String) }) })) }))(JSON.parse(dynamic.stdout)).observations[0]!.observation;
      assert.ok(inventory.gaps.includes('GoDynamicSubtestsUnknown'));
      assert.equal(inventory.value.cases.length, 1);
      assert.ok(inventory.value.cases[0]!.nativeId.endsWith(':TestDynamic'));

    }
  }));
})).pipe(Effect.provide(OwnedProcessLive), Effect.provideService(RuntimeEnvironment, makeRuntimeEnvironment(process.cwd(), process.env)))));
