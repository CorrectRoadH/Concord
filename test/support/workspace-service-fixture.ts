import { Effect, Layer } from 'effect';
import { TestClock } from 'effect/testing';
import { WorkspaceState } from '../../src/entry/server/state.js';
import type { RuntimePorts } from '../../src/entry/server/service.js';
import type { WorkspaceProjection, WorkspaceProjectionRecord } from '../../src/model/index.js';
import { displaySnapshot } from './workspace-display-fixture.js';
export const record: WorkspaceProjectionRecord = { sourceDigest: 'fixture-sources', builtAt: '2026-10-30T00:00:00.000Z', builtFrom: '2026-10-30T00:00:00.000Z', builtUntil: '2026-10-30T00:00:00.000Z', complete: true, changedPaths: [], unknownRelations: false, snapshot: { ...displaySnapshot, cache: { status: 'ready' }, diagnostics: { operation: 'doctor', ok: true, root: '/worktree', node: 'test', configuration: {}, missingTestRoots: [], missingSourceRoots: [], codeDeclarations: 1, documents: 2, cases: 2, findings: [], nextSteps: [] } } };
const { snapshot, ...status } = record;
export const projection: WorkspaceProjection = { snapshot, projection: { ...status, status: 'ready', current: false, refreshOwner: 'active' } };
export const ports = (overrides: Partial<RuntimePorts> = {}): RuntimePorts => ({
  sourceDigest: Effect.succeed(record.sourceDigest), verify: Effect.void, context: Effect.succeed({ root: '/fixture', privateDir: '/fixture/private', identity: 'fixture' }),
  ready: () => Effect.void, restore: () => Effect.succeed(projection), persist: () => Effect.void,
  compute: () => Effect.succeed(record), open: Effect.void, close: Effect.void,
  clear: Effect.succeed({ status: 'cleared' }), exists: Effect.succeed(true), ...overrides,
});
export const stateLayer = WorkspaceState.layer('test-instance').pipe(Layer.provideMerge(TestClock.layer()));

