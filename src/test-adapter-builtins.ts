// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/run-native-test-adapters.md
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Schema } from 'effect';
import { ConcordError, Text } from './shared.js';
import type { TestAdapter } from './test-adapter-config.js';
import { type AdapterContext, type AdapterPlan, type AdapterReport, type Captured, type Capabilities, type NativeCase, type NativeManifest, PlanSchema, protocolDecode, protocolJson } from './test-adapter-protocol.js';

const capabilities = (changes: Partial<Capabilities> = {}): Capabilities => ({ realCollection: true, leaf: true, parameterGroups: false, exactSelection: true, perItemReport: true, range: false, rangeTrivia: false, tags: false, skipVisibility: true, ...changes });
const regex = (text: string) => text.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&');
const PYTEST: [string, ...string[]] = ['uv', 'run', '--offline', '--no-project', '--with', 'pytest==9.1.1', 'pytest'];
const VitestCollected = Schema.Array(Schema.Struct({ name: Text, file: Text, project: Text, skipped: Schema.Boolean }));
const VitestReport = Schema.Struct({ success: Schema.Boolean, testResults: Schema.Array(Schema.Struct({ name: Text, status: Text, message: Schema.String, assertionResults: Schema.Array(Schema.Struct({ fullName: Text, status: Text, title: Text, ancestorTitles: Schema.Array(Schema.String), failureMessages: Schema.Array(Schema.String), duration: Schema.optional(Schema.Number), meta: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)), tags: Schema.optional(Schema.Array(Schema.String)) })) })) });
const GoEvent = Schema.Struct({ Action: Text, Test: Schema.optional(Text), Package: Schema.optional(Text), Output: Schema.optional(Schema.String), Time: Schema.optional(Schema.String), Elapsed: Schema.optional(Schema.Number), FailedBuild: Schema.optional(Schema.String) });
export function builtinVersionCommand(adapter: TestAdapter): readonly string[] {
  switch (adapter.builtin) {
    case 'node-test': return [process.execPath, '--version'];
    case 'vitest': return [process.execPath, 'node_modules/vitest/vitest.mjs', '--version'];
    case 'pytest': return [...PYTEST, '--version'];
    case 'go': return ['go', 'version'];
    case 'cargo': return ['cargo', '+stable', '--version'];
    default: throw new ConcordError('AdapterProtocolInvalid', 'Unknown builtin adapter');
  }
}
function native(adapter: TestAdapter, file: string, name: string, project = 'default'): NativeCase {
  return { nativeId: `${adapter.builtin}:${adapter.id}:${project}:${adapter.builtin === 'pytest' ? name : `${file}:${name}`}`, file, project, kind: 'leaf', selection: { opaqueId: name, capabilityVersion: `${adapter.builtin}/${adapter.frameworkVersion}/v1` }, tags: {}, provenance: `${adapter.builtin}/${adapter.frameworkVersion}` };
}
function cargoTarget(root: string, file: string): { cwd: string; args: string[]; project: string } {
  let directory = dirname(file);
  while (directory !== '.' && !existsSync(join(root, directory, 'Cargo.toml'))) directory = dirname(directory);
  if (!existsSync(join(root, directory, 'Cargo.toml'))) throw new ConcordError('NativeSelectionUnsupported', 'Cargo test file has no workspace manifest');
  const local = relative(directory, file);
  if (local === 'src/lib.rs') return { cwd: directory, args: ['--lib'], project: `${directory}:lib` };
  if (/^tests\/[^/]+\.rs$/u.test(local)) return { cwd: directory, args: ['--test', local.slice(6, -3)], project: `${directory}:test:${local.slice(6, -3)}` };
  throw new ConcordError('NativeSelectionUnsupported', 'Builtin Cargo adapter supports an explicit library root or integration-test target; other file membership needs a provider');
}
export function builtinCollectPlan(adapter: TestAdapter, context: AdapterContext, files: readonly string[]): AdapterPlan {
  const invocations = files.map((file, index) => {
    const invocationId = `collect-${index}`;
    const base = { invocationId, cwd: '.', envNames: adapter.envNames, reports: [] as string[] };
    switch (adapter.builtin) {
      case 'node-test': return { ...base, argv: [process.execPath, '--version'] as [string, ...string[]] };
      case 'vitest': return { ...base, argv: [process.execPath, fileURLToPath(new URL('./test-adapter-vitest.js', import.meta.url)), context.root, file, join(context.reportDirectory, invocationId, 'manifest.json')] as [string, ...string[]], reports: ['manifest.json'] };
      case 'pytest': return { ...base, argv: [...PYTEST, '--rootdir', context.root, '--collect-only', '-q', '--color=no', '-o', 'addopts=', '-p', 'no:cacheprovider', file] as [string, ...string[]] };
      case 'go': return { ...base, cwd: dirname(file), argv: ['go', 'test', '-list', '^Test', '.'] as [string, ...string[]] };
      case 'cargo': { const target = cargoTarget(context.root, file); return { ...base, cwd: target.cwd, argv: ['cargo', '+stable', 'test', '--offline', ...target.args, '--', '--list', '--format=terse'] as [string, ...string[]] }; }
      default: throw new ConcordError('AdapterProtocolInvalid', 'Unknown builtin');
    }
  });
  return protocolDecode(PlanSchema, { invocations, planContext: { files } });
}
export function builtinCollectParse(adapter: TestAdapter, context: AdapterContext, files: readonly string[], captures: readonly Captured[]): NativeManifest {
  const cases: NativeCase[] = []; const gaps: string[] = ['RangeUnavailable', 'ParameterGroupsUnavailable', 'TagsUnavailable'];
  for (const [index, captured] of captures.entries()) {
    const file = files[index]!;
    switch (adapter.builtin) {
      case 'node-test': gaps.push('NodeCollectionUnsupported'); break;
      case 'vitest': {
        const values = protocolDecode(VitestCollected, protocolJson(captured.reports[0]!.text));
        for (const value of values) {
          const actual = relative(context.root, value.file).replaceAll('\\', '/');
          if (actual !== file) throw new ConcordError('AdapterProtocolInvalid', 'Vitest collected a module outside the requested file');
          cases.push(native(adapter, file, value.name, value.project));
        }
        break;
      }
      case 'pytest':
        for (const line of captured.stdout.split(/\r?\n/u)) if (line.startsWith(`${file}::`)) cases.push(native(adapter, file, line));
        break;
      case 'go':
        if (!file.endsWith('_test.go') || readdirSync(join(context.root, dirname(file))).filter(path => path.endsWith('_test.go')).length !== 1) { gaps.push('GoFileMembershipUnknown'); break; }
        for (const line of captured.stdout.split(/\r?\n/u)) if (/^Test\S*$/u.test(line)) cases.push(native(adapter, file, line, dirname(file)));
        // -list cannot observe dynamically registered subtests or skip behavior.
        gaps.push('GoDynamicSubtestsUnknown', 'SkipVisibilityUnavailable');
        break;
      case 'cargo': {
        const target = cargoTarget(context.root, file);
        if (captured.stdout.split(/\r?\n/u).some(line => line.endsWith(': test') && line.slice(0, -6).includes('::'))) { gaps.push('CargoFileMembershipUnknown'); break; }
        for (const line of captured.stdout.split(/\r?\n/u)) if (line.endsWith(': test')) cases.push(native(adapter, file, line.slice(0, -6), target.project));
        break;
      }
    }
  }
  if (new Set(cases.map(item => item.nativeId)).size !== cases.length) throw new ConcordError('AmbiguousNativeBinding', 'Framework names collide within a project/file/target');
  return { cases, capabilities: capabilities(adapter.builtin === 'node-test' ? { realCollection: false, leaf: false, exactSelection: false, perItemReport: false, skipVisibility: false } : adapter.builtin === 'go' ? { skipVisibility: false } : {}), completeness: { complete: adapter.builtin !== 'node-test' && !gaps.includes('GoFileMembershipUnknown') && !gaps.includes('CargoFileMembershipUnknown'), gaps } };
}
export function builtinSelectPlan(adapter: TestAdapter, context: AdapterContext, manifest: NativeManifest, requested: readonly string[]): AdapterPlan {
  const selected = requested.map(id => manifest.cases.find(item => item.nativeId === id)!);
  const invocations = selected.map((item, index) => {
    const invocationId = `test-${index}`; const name = item.selection.opaqueId;
    const base = { invocationId, cwd: '.', envNames: adapter.envNames, reports: [] as string[], requested: [item.nativeId] };
    switch (adapter.builtin) {
      case 'vitest': return { ...base, argv: [process.execPath, 'node_modules/vitest/vitest.mjs', 'run', item.file, ...(item.project === 'default' ? [] : ['--project', item.project]), '-t', `^${regex(name)}$`, '--retry=0', '--reporter=json', '--outputFile', join(context.reportDirectory, invocationId, 'results.json'), '--no-color'] as [string, ...string[]], reports: ['results.json'] };
      case 'pytest': return { ...base, argv: [...PYTEST, '--rootdir', context.root, '--color=no', '-o', 'addopts=', '-p', 'no:cacheprovider', '-v', '--tb=no', name] as [string, ...string[]] };
      case 'go': return { ...base, cwd: dirname(item.file), argv: ['go', 'test', '-count=1', '-json', '-run', `^${regex(name)}$`, '.'] as [string, ...string[]] };
      case 'cargo': { const target = cargoTarget(context.root, item.file); return { ...base, cwd: target.cwd, argv: ['cargo', '+stable', 'test', '--offline', ...target.args, '--', '--exact', name, '--format=pretty', '--color=never'] as [string, ...string[]] }; }
      default: throw new ConcordError('NativeSelectionUnsupported', 'This builtin cannot make an exact native selection');
    }
  });
  return protocolDecode(PlanSchema, { invocations, planContext: { selected } });
}
export function builtinReportParse(adapter: TestAdapter, selected: readonly NativeCase[], captures: readonly Captured[]): AdapterReport {
  const observed: AdapterReport['observed'][number][] = [];
  let complete = true;
  for (const [index, captured] of captures.entries()) {
    const item = selected[index]!; const name = item.selection.opaqueId;
    const push = (nativeId: string, outcome: 'passed' | 'failed' | 'skipped' | 'todo' | 'not-run') => observed.push({ nativeId, outcome, provenance: item.provenance });
    switch (adapter.builtin) {
      case 'vitest': {
        // Framework JSON contains additional version-specific statistics. Decode a projection;
        // the adapter's own envelope and native result remain strict.
        const value = Schema.decodeUnknownSync(VitestReport, { onExcessProperty: 'ignore' })(protocolJson(captured.reports[0]!.text));
        if (value.testResults.some(module => module.message !== '')) complete = false;
        for (const module of value.testResults) for (const result of module.assertionResults) {
          if (result.fullName !== name && (result.status === 'skipped' || result.status === 'pending')) continue; // excluded by the exact plan
          const nativeId = result.fullName === name ? item.nativeId : `${item.nativeId}:extra:${result.fullName}`;
          push(nativeId, result.status === 'passed' ? 'passed' : result.status === 'failed' ? 'failed' : 'skipped');
        }
        break;
      }
      case 'pytest': {
        for (const line of captured.stdout.split(/\r?\n/u)) {
          const match = /^(.*?) (PASSED|FAILED|SKIPPED|XFAIL|XPASS|ERROR)(?:\s|$)/u.exec(line);
          if (!match || !match[1]?.includes('::')) continue;
          const id = match[1] === name ? item.nativeId : `${item.nativeId}:extra:${match[1]}`;
          if (match[2] === 'ERROR') complete = false;
          push(id, match[2] === 'PASSED' ? 'passed' : match[2] === 'FAILED' ? 'failed' : 'skipped');
        }
        break;
      }
      case 'go':
        for (const line of captured.stdout.split(/\r?\n/u).filter(Boolean)) {
          const value = Schema.decodeUnknownSync(GoEvent, { onExcessProperty: 'ignore' })(protocolJson(line));
          if (value.Action === 'build-fail') complete = false;
          if (value.Test && ['pass', 'fail', 'skip'].includes(value.Action)) push(value.Test === name ? item.nativeId : `${item.nativeId}:extra:${value.Test}`, value.Action === 'pass' ? 'passed' : value.Action === 'fail' ? 'failed' : 'skipped');
        }
        break;
      case 'cargo':
        for (const line of captured.stdout.split(/\r?\n/u)) {
          const match = /^test (.+) \.\.\. (ok|FAILED|ignored)(?:\s|$)/u.exec(line);
          if (match) push(match[1] === name ? item.nativeId : `${item.nativeId}:extra:${match[1]}`, match[2] === 'ok' ? 'passed' : match[2] === 'FAILED' ? 'failed' : 'skipped');
        }
        break;
    }
  }
  return { observed, capabilities: capabilities(), completeness: { complete, gaps: complete ? [] : ['FrameworkInfrastructureFailure'] } };
}
