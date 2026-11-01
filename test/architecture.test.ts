import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Effect } from 'effect';
import { dependencyViolations, inspectArchitecture } from './support/architecture.js';

const root = fileURLToPath(new URL('../', import.meta.url));

// @feature docs/engineering/concord-self-hosting/test-architecture.md#架构守护
test('source import and export graphs obey module exits, layers, domain order and composition roots', () => Effect.runSync(Effect.sync(() => {
  const audit = inspectArchitecture(root);
  assert.deepEqual(dependencyViolations(audit), []);
})));

// @feature docs/engineering/concord-self-hosting/test-architecture.md#架构守护
test('model, domain and application code access platform capabilities through services', () => Effect.runSync(Effect.sync(() => {
  assert.deepEqual(inspectArchitecture(root).platform, []);
})));

// @feature docs/engineering/concord-self-hosting/test-architecture.md#架构守护
test('domain and application consumers cannot open persistent cache handles or select their own access mode', () => Effect.runSync(Effect.sync(() => {
  const audit = inspectArchitecture(root);
  assert.deepEqual(audit.edges.filter(edge => /^src\/(?:domain|app)\//u.test(edge.from)
    && edge.to === 'src/base/cache/index.ts'
    && edge.bindings.some(name => name === 'openHawdb' || name === 'withPersistentCache')), []);
})));

// @feature docs/engineering/concord-self-hosting/test-architecture.md#架构守护
test('architecture audit sees type exports, finite dynamic imports and aliased process capabilities', () => Effect.runSync(Effect.sync(() => {
  const sources = new Map([
    ['src/model/index.ts', 'export type { Hidden } from "../domain/documents/index.js";'],
    ['src/domain/documents/index.ts', 'import type { BadDirection } from "../issues/index.js"; export interface Hidden { readonly name: string }'],
    ['src/domain/issues/index.ts', 'import type { Hidden } from "../documents/index.js"; export interface BadDirection { readonly item: Hidden }; const runtime = process; const { env: settings } = runtime; runtime["stdout"].write("x"); const target = settings.TERM ? "../documents/index.js" : "../../app/index.js"; void import(target);'],
    ['src/app/index.ts', 'export const ready = true;'],
  ]);
  const audit = inspectArchitecture(root, sources);
  assert.deepEqual(audit.edges.filter(edge => edge.from === 'src/domain/issues/index.ts' && edge.kind === 'dynamic').map(edge => edge.to).sort(), ['src/app/index.ts', 'src/domain/documents/index.ts']);
  assert.ok(audit.edges.some(edge => edge.kind === 'export' && edge.typeOnly));
  assert.ok(audit.edges.some(edge => edge.kind === 'import' && edge.typeOnly));
  assert.deepEqual(new Set(audit.platform.map(item => item.code)), new Set(['ProcessDestructure', 'ProcessCapability']));
  assert.ok(dependencyViolations(audit).some(item => item.code === 'LayerDirection'));
  assert.ok(dependencyViolations(audit).some(item => item.code === 'DomainOrder' && item.file === 'src/domain/documents/index.ts' && item.text.startsWith('import type:')));
  const opaque = inspectArchitecture(root, new Map([['src/app/index.ts', 'export const load = (path: string) => import(path);']]));
  assert.deepEqual(opaque.invalid.map(item => item.code), ['UnenumerableDynamicImport']);
})));
