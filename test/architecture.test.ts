import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { dependencyViolations, domainCycles, inspectArchitecture, violationKey } from './support/architecture.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const baselinePath = 'test/support/platform-violations.json';
const Baseline = Schema.fromJsonString(Schema.Struct({ format: Schema.Literal('concord.platform-debt/v1'), violations: Schema.Array(Schema.String) }));

// @feature docs/engineering/concord-self-hosting/README.md#技术栈
test('source import and export graphs obey module exits, layers, domain order and composition roots', () => Effect.runSync(Effect.sync(() => {
  const audit = inspectArchitecture(root);
  assert.deepEqual(dependencyViolations(audit), []);
  assert.deepEqual(domainCycles(audit, false), [], 'value dependencies must be acyclic');
  assert.deepEqual(domainCycles(audit, true), [], 'type dependencies must be acyclic');
})));

// @feature docs/engineering/concord-self-hosting/README.md#技术栈
test('platform capability debt only decreases while services are migrated', () => Effect.runSync(Effect.sync(() => {
  const baseline = Schema.decodeUnknownSync(Baseline, { onExcessProperty: 'error' })(readFileSync(`${root}/${baselinePath}`, 'utf8'));
  const current = inspectArchitecture(root).platform.map(violationKey);
  const counts = (values: readonly string[]) => { const result = new Map<string, number>(); for (const value of values) result.set(value, (result.get(value) ?? 0) + 1); return result; };
  const allowed = counts(baseline.violations);
  assert.deepEqual([...counts(current)].filter(([key, count]) => count > (allowed.get(key) ?? 0)), [], 'new platform accesses require migration into base or entry');
  const commits = execFileSync('git', ['log', '--reverse', '--first-parent', '--format=%H', '--', baselinePath], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const versions = commits.map(commit => ({
    label: commit,
    allowed: counts(Schema.decodeUnknownSync(Baseline, { onExcessProperty: 'error' })(execFileSync('git', ['show', `${commit}:${baselinePath}`], { cwd: root, encoding: 'utf8' })).violations),
  }));
  versions.push({ label: 'worktree', allowed });
  for (let index = 1; index < versions.length; index += 1) {
    const previous = versions[index - 1]!.allowed;
    const grown = [...versions[index]!.allowed].filter(([key, count]) => count > (previous.get(key) ?? 0));
    assert.deepEqual(grown, [], `the debt list can only shrink (${versions[index]!.label})`);
  }
})));

// @feature docs/engineering/concord-self-hosting/README.md#技术栈
test('domain and application consumers cannot open persistent cache handles or select their own access mode', () => Effect.runSync(Effect.sync(() => {
  const audit = inspectArchitecture(root);
  assert.deepEqual(audit.edges.filter(edge => /^src\/(?:domain|app)\//u.test(edge.from)
    && edge.to === 'src/base/cache/index.ts'
    && edge.bindings.some(name => name === 'openHawdb' || name === 'withPersistentCache')), []);
})));

// @feature docs/engineering/concord-self-hosting/README.md#技术栈
test('architecture audit sees type exports, finite dynamic imports and aliased process capabilities', () => Effect.runSync(Effect.sync(() => {
  const sources = new Map([
    ['src/model/index.ts', 'export type { Hidden } from "../domain/documents/index.js";'],
    ['src/domain/documents/index.ts', 'export interface Hidden { readonly name: string }'],
    ['src/domain/issues/index.ts', 'import type { Hidden } from "../documents/index.js"; const runtime = process; const { env: settings } = runtime; runtime["stdout"].write("x"); const target = settings.TERM ? "../documents/index.js" : "../../app/index.js"; void import(target);'],
    ['src/app/index.ts', 'export const ready = true;'],
  ]);
  const audit = inspectArchitecture(root, sources);
  assert.deepEqual(audit.edges.filter(edge => edge.from === 'src/domain/issues/index.ts' && edge.kind === 'dynamic').map(edge => edge.to).sort(), ['src/app/index.ts', 'src/domain/documents/index.ts']);
  assert.ok(audit.edges.some(edge => edge.kind === 'export' && edge.typeOnly));
  assert.ok(audit.edges.some(edge => edge.kind === 'import' && edge.typeOnly));
  assert.deepEqual(new Set(audit.platform.map(item => item.code)), new Set(['ProcessDestructure', 'ProcessCapability']));
  assert.ok(dependencyViolations(audit).some(item => item.code === 'LayerDirection'));
  const opaque = inspectArchitecture(root, new Map([['src/app/index.ts', 'export const load = (path: string) => import(path);']]));
  assert.deepEqual(opaque.invalid.map(item => item.code), ['UnenumerableDynamicImport']);
})));
