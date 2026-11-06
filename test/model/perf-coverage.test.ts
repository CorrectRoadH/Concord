import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect } from 'effect';
import { API } from 'typescript/sync';
import * as ts from 'typescript/ast';
import { loadBudgets } from '../../scripts/perf/budgets.ts';
import { selectScenarios } from '../../scripts/perf/selection.ts';
import { loadScenarios, runArguments } from '../../scripts/perf/scenario.ts';
import { benchmarkSmokeGroups } from '../support/benchmark-smoke.ts';
import { fullCommand } from '../../src/entry/cli/cli-full.ts';
const root = resolve('.');
// @feature docs/feature/local-sdlc/README.md
test('performance budgets and executable scenarios have exactly one consistent owner', () => Effect.runPromise(Effect.gen(function*() {
  const scenarios = yield* loadScenarios(root), budgets = yield* loadBudgets(root);
  const ids = scenarios.map(s => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const row of budgets) for (const id of row.scenarios) { assert.ok(ids.includes(id), `Missing scenario ${id}`); assert.equal(id.split('/')[0], row.featureId); }
  for (const id of ids) assert.equal(budgets.filter(row => row.scenarios.includes(id)).length, 1, id);
  assert.deepEqual(selectScenarios(scenarios, ['local-sdlc']).map(s => s.id), ids.filter(id => id.startsWith('local-sdlc/')));
  assert.equal(selectScenarios(scenarios, [], { files: ['scripts/perf/stats.ts'], features: [] }).length, ids.length);
  assert.deepEqual(selectScenarios(scenarios, [], { files: ['bench/feedback.bench.ts'], features: [] }).map(s => s.id), ['feedback/list']);
  assert.throws(() => selectScenarios(scenarios, ['absent']));
}).pipe(Effect.provide(NodeServices.layer))));
// @feature docs/feature/local-sdlc/README.md
test('CLI top-level command definitions have scenarios or documented exemptions', () => Effect.runPromise(Effect.gen(function*() {
  const groups = fullCommand.subcommands.flatMap(group => group.commands.map(command => command.name));
  const scenarios = yield* loadScenarios(root);
  const policy = readFileSync(join(root, 'docs/engineering/performance/format.md'), 'utf8');
  const exemptions = [...policy.matchAll(/^\| ((?:`[^`]+`[、 ]*)+) \| ([^|]+) \|$/gmu)].flatMap(match => [...match[1]!.matchAll(/`([^`]+)`/gu)].map(item => item[1]!));
  const covered = scenarios.map(s => runArguments(s.run).find(arg => !arg.startsWith('--')));
  for (const group of groups) assert.ok(covered.includes(group) || exemptions.includes(group), `Uncovered CLI command group: ${group}`);
}).pipe(Effect.provide(NodeServices.layer))));
// @feature docs/engineering/testing/README.md#成本与稳定
test('benchmark smoke files partition every scenario exactly once', () => Effect.runPromise(Effect.gen(function*() {
  const scenarios = yield* loadScenarios(root);
  const selected: string[] = [];
  const files = ['test/cli', 'test/process'].flatMap(directory => readdirSync(join(root, directory))
    .filter(name => /^perf-(?:service-)?coverage(?:-[a-z0-9-]+)?\.test\.ts$/u.test(name))
    .map(name => join(root, directory, name)));
  const api = yield* Effect.acquireRelease(Effect.sync(() => new API({ runExternalCode: false })), api => Effect.sync(() => api.close()));
  for (const file of files) {
    const source = api.createSourceFile(file, readFileSync(file, 'utf8'), { scriptKind: ts.ScriptKind.TS });
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ['benchmarkSmoke', 'benchmarkCliSmoke'].includes(node.expression.text)) {
        const cli = node.expression.text === 'benchmarkCliSmoke';
        const [service, feature, indices] = cli ? [undefined, ...node.arguments] : node.arguments;
        assert.ok(cli || service && (service.kind === ts.SyntaxKind.TrueKeyword || service.kind === ts.SyntaxKind.FalseKeyword), `${file}: literal service selector required`);
        assert.ok(feature && ts.isStringLiteral(feature), `${file}: literal feature selector required`);
        let groups: number[] | undefined;
        if (indices !== undefined) {
          assert.ok(ts.isArrayLiteralExpression(indices), `${file}: literal group selectors required`);
          groups = indices.elements.map(index => { assert.ok(ts.isNumericLiteral(index), `${file}: numeric group selector required`); return Number(index.text); });
        }
        selected.push(...benchmarkSmokeGroups(scenarios, service?.kind === ts.SyntaxKind.TrueKeyword, feature.text, groups).flatMap(group => group.scenarios.map(scenario => scenario.id)));
      }
      node.forEachChild(visit);
    };
    try { visit(source.sourceFile); } finally { source.dispose(); }
  }
  assert.deepEqual(selected.sort(), scenarios.map(scenario => scenario.id).sort(), 'Smoke files must execute the complete scenario set exactly once');
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))));
