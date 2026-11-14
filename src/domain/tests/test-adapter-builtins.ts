// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/collect-native-tests.md
import { workerEntryArgv } from "../../base/installation/index.ts";
import { Sources } from '../../base/sources/index.ts';
import { dirname, join, relative } from "node:path";

import { Effect, Schema } from "effect";
import { ConcordError, Text, failure } from "../../model/index.ts";
import type { test_adapter_config_TestAdapter as TestAdapter } from "../../model/index.ts";
import { type AdapterContext, type Captured, type Capabilities, type NativeCase, ManifestSchema, test_adapter_protocol_PlanSchema as PlanSchema, protocolDecode, protocolJson } from "../../model/index.ts";

const capabilities = (changes: Partial<Capabilities> = {}): Capabilities => ({ realCollection: true, leaf: true, parameterGroups: false, range: false, rangeTrivia: false, tags: false, ...changes });
const PYTEST: [string, ...string[]] = ['uv', 'run', '--offline', '--no-project', '--with', 'pytest==9.2.0', 'pytest'];
const VitestCollected = Schema.Array(Schema.Struct({ name: Text, file: Text, project: Text, tags: Schema.Record(Schema.String, Schema.String) }));
export function builtinVersionCommand(adapter: TestAdapter): readonly string[] {
  switch (adapter.builtin) {
    case 'node-test': return ['node', '--version'];
    case 'vitest': return ['node', 'node_modules/vitest/vitest.mjs', '--version'];
    case 'pytest': return [...PYTEST, '--version'];
    case 'go': return ['go', 'version'];
    case 'cargo': return ['cargo', '+stable', '--version'];
    default: throw new ConcordError('AdapterProtocolInvalid', 'Unknown builtin adapter');
  }
}
function native(adapter: TestAdapter, file: string, name: string, project = 'default'): NativeCase {
  return { nativeId: `${adapter.builtin}:${adapter.id}:${project}:${adapter.builtin === 'pytest' ? name : `${file}:${name}`}`, file, project, kind: 'leaf', tags: {}, provenance: `${adapter.builtin}/${adapter.frameworkVersion ?? 'unknown'}` };
}
const cargoTarget = Effect.fn('Tests.cargoTarget')(function*(root: string, file: string) {
  const sources = yield* Sources;
  let directory = dirname(file);
  while (directory !== '.' && !(yield* sources.existsAt(join(root, directory, 'Cargo.toml')))) directory = dirname(directory);
  if (!(yield* sources.existsAt(join(root, directory, 'Cargo.toml')))) return yield* Effect.fail(new ConcordError('NativeBindingUnavailable', 'Cargo test file has no workspace manifest'));
  const local = relative(directory, file);
  if (local === 'src/lib.rs') return { cwd: directory, args: ['--lib'], project: `${directory}:lib` };
  if (/^tests\/[^/]+\.rs$/u.test(local)) return { cwd: directory, args: ['--test', local.slice(6, -3)], project: `${directory}:test:${local.slice(6, -3)}` };
  return yield* Effect.fail(new ConcordError('NativeBindingUnavailable', 'Builtin Cargo adapter supports an explicit library root or integration-test target; other file membership needs a provider'));
});
export const builtinCollectPlan = Effect.fn('Tests.builtinCollectPlan')(function*(adapter: TestAdapter, context: AdapterContext, files: readonly string[]) {
  const invocations = yield* Effect.forEach(files, Effect.fn(function*(file, index) {
    const invocationId = `collect-${index}`;
    const base = { invocationId, cwd: '.', envNames: adapter.envNames, reports: [] as string[] };
    switch (adapter.builtin) {
      case 'node-test': return { ...base, argv: ['node', '--version'] as [string, ...string[]] };
      case 'vitest': return { ...base, argv: [process.execPath, ...workerEntryArgv('test-adapter-vitest'), context.root, file, join(context.reportDirectory, invocationId, 'manifest.json')] as [string, ...string[]], reports: ['manifest.json'] };
      case 'pytest': return { ...base, argv: [...PYTEST, '--rootdir', context.root, '--collect-only', '-q', '--color=no', '-o', 'addopts=', '-p', 'no:cacheprovider', file] as [string, ...string[]] };
      case 'go': return { ...base, cwd: dirname(file), argv: ['go', 'test', '-list', '^Test', '.'] as [string, ...string[]] };
      case 'cargo': { const target = yield* cargoTarget(context.root, file); return { ...base, cwd: target.cwd, argv: ['cargo', '+stable', 'test', '--offline', ...target.args, '--', '--list', '--format=terse'] as [string, ...string[]] }; }
      default: throw new ConcordError('AdapterProtocolInvalid', 'Unknown builtin');
    }
  }));
  return protocolDecode(PlanSchema, { invocations, planContext: { files } });
}, Effect.catchDefect(cause => Effect.fail(failure(cause))));
export const builtinCollectParse = Effect.fn('Tests.builtinCollectParse')(function*(adapter: TestAdapter, context: AdapterContext, files: readonly string[], captures: readonly Captured[]) {
  const sources = yield* Sources;
  const cases: NativeCase[] = []; const gaps: string[] = ['RangeUnavailable', 'ParameterGroupsUnavailable', ...(adapter.builtin === 'vitest' ? [] : ['TagsUnavailable'])];
  for (const [index, captured] of captures.entries()) {
    const file = files[index]!;
    switch (adapter.builtin) {
      case 'node-test': gaps.push('NodeCollectionUnsupported'); break;
      case 'vitest': {
        const values = protocolDecode(VitestCollected, protocolJson(captured.reports[0]!.text));
        for (const value of values) {
          const actual = relative(context.root, value.file).replaceAll('\\', '/');
          if (actual !== file) throw new ConcordError('AdapterProtocolInvalid', 'Vitest collected a module outside the requested file');
          cases.push({ ...native(adapter, file, value.name, value.project), tags: value.tags });
        }
        break;
      }
      case 'pytest':
        for (const line of captured.stdout.split(/\r?\n/u)) if (line.startsWith(`${file}::`)) cases.push(native(adapter, file, line));
        break;
      case 'go':
        if (!file.endsWith('_test.go') || (yield* sources.directoryEntries(join(context.root, dirname(file)))).filter(path => path.endsWith('_test.go')).length !== 1) { gaps.push('GoFileMembershipUnknown'); break; }
        for (const line of captured.stdout.split(/\r?\n/u)) if (/^Test\S*$/u.test(line)) cases.push(native(adapter, file, line, dirname(file)));
        // -list cannot observe dynamically registered subtests or skip behavior.
        gaps.push('GoDynamicSubtestsUnknown');
        break;
      case 'cargo': {
        const target = yield* cargoTarget(context.root, file);
        if (captured.stdout.split(/\r?\n/u).some(line => line.endsWith(': test') && line.slice(0, -6).includes('::'))) { gaps.push('CargoFileMembershipUnknown'); break; }
        for (const line of captured.stdout.split(/\r?\n/u)) if (line.endsWith(': test')) cases.push(native(adapter, file, line.slice(0, -6), target.project));
        break;
      }
    }
  }
  if (new Set(cases.map(item => item.nativeId)).size !== cases.length) throw new ConcordError('AmbiguousNativeBinding', 'Framework names collide within a project/file/target');
  return protocolDecode(ManifestSchema, { cases, capabilities: capabilities(adapter.builtin === 'node-test' ? { realCollection: false, leaf: false } : { tags: adapter.builtin === 'vitest' }), completeness: { complete: gaps.length === 0, gaps } });
}, Effect.catchDefect(cause => Effect.fail(failure(cause))));
