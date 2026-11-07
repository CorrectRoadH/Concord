import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dependencyViolations, inspectArchitecture, type Audit, type Edge } from '../support/architecture.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));

// @feature docs/engineering/testing/architecture.md#架构守护
test('only explicit CLI run captures the host while the thin source guard can read argv', async () => {
  const audit = (await inspectArchitecture(root, new Map([
    ['src/entry/cli/run.ts', "process.env.HOME; process.cwd(); process.argv; process.on('SIGINT', () => {}); process.exit(0);"],
    ['src/entry/cli/entry.ts', 'void process.argv; process.cwd(); process.env.HOME;'],
    ['src/entry/cli/other-run.ts', 'process.argv; process.env.HOME;'],
  ])));
  assert.deepEqual(audit.platform.filter(item => item.file.endsWith('/entry.ts')).map(item => item.text), ['process.cwd', 'process.env']);
  assert.equal(audit.platform.some(item => item.file.endsWith('/run.ts')), false);
  assert.equal(audit.platform.filter(item => item.file.endsWith('/other-run.ts')).length, 2);
});

// @feature docs/engineering/testing/architecture.md#架构守护
test('only the project-owned Vitest implementation may import a nonliteral module path', async () => {
  const audit = (await inspectArchitecture(root, new Map([
    ['src/entry/server/test-adapter-vitest-main.ts', 'export const load = path => import(path);'],
    ['src/entry/server/test-adapter-vitest.ts', 'export const load = path => import(path);'],
    ['src/entry/server/another-main.ts', 'export const load = path => import(path);'],
  ])));
  assert.deepEqual(audit.invalid.map(item => item.file), ['src/entry/server/another-main.ts', 'src/entry/server/test-adapter-vitest.ts']);
});

const edge = (from: string, to: string, kind = 'dynamic'): Edge => ({ from, to, specifier: to, typeOnly: false, kind, line: 1, bindings: [] });
const audit = (edges: readonly Edge[]): Audit => ({ files: [], edges, invalid: [], platform: [] });

// @feature docs/engineering/testing/architecture.md#架构守护
test('compiled dispatch permits only the nine exact role imports', () => {
  const roles = [
    'src/entry/cli/run.ts', 'src/entry/server/compute-worker-main.ts', 'src/entry/server/editor-worker-main.ts',
    'src/entry/server/query-refresh-worker-main.ts', 'src/entry/server/query-scan-worker-main.ts',
    'src/entry/server/view-scan-worker-main.ts', 'src/entry/server/cache-maintenance-worker-main.ts',
    'src/entry/server/test-adapter-vitest-main.ts', 'src/entry/server/operation/run.ts',
  ];
  const from = 'src/entry/compiled/run.ts';
  assert.deepEqual(dependencyViolations(audit(roles.map(to => edge(from, to)))), []);
  for (const invalid of [edge(from, 'src/entry/web-build/main.ts'), edge(from, 'src/entry/server/main.ts'), edge(from, roles[0]!, 'import'), edge('src/entry/compiled/another-run.ts', roles[0]!)]) {
    assert.deepEqual(dependencyViolations(audit([invalid])).map(item => item.code), ['ModuleExit', 'LayerDirection']);
  }
});

// @feature docs/engineering/testing/architecture.md#架构守护
test('moved operation composition root and source Web builder keep precise module boundaries', () => {
  const operation = edge('src/entry/server/operation/run.ts', 'src/base/installation/index.ts', 'import');
  const builder = edge('src/entry/web-build/main.ts', 'src/base/installation/source-web-builder.ts', 'import');
  assert.deepEqual(dependencyViolations(audit([operation, builder])), []);
  assert.deepEqual(dependencyViolations(audit([{ ...operation, from: 'src/entry/server/operation/another-run.ts' }])).map(item => item.code), ['LayerDirection']);
  assert.deepEqual(dependencyViolations(audit([{ ...builder, from: 'src/entry/cli/main.ts' }])).map(item => item.code), ['ModuleExit']);
});
