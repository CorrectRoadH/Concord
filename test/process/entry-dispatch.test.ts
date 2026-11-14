// 跨进程保证：运行环境——源码薄入口与编译分派共用显式启动，导入不安装生命周期监听或消费标准输入。
// 跨进程保证：外部程序——内部选择器只在第一位生效，真实 Vitest 收到归一化参数且只执行一次。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = join(root, 'src/entry/cli/entry.ts');
const dispatcher = join(root, 'src/entry/compiled/main.ts');
const options = ['--no-env-file', '--config=/dev/null', '--conditions=concord-source'];
const environment = { ...process.env, NO_COLOR: '1', TERM: 'dumb', FORCE_COLOR: undefined };
const invoke = (args: readonly string[], input?: string, cwd = root) => {
  const result = spawnSync('bun', [...options, ...args], { cwd, env: environment, input, encoding: 'utf8', timeout: 15_000 });
  assert.equal(result.error, undefined, result.error?.message ?? result.stderr);
  assert.equal(result.signal, null, result.stderr);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

// @feature docs/engineering/build/architecture.md#编译入口
test('importing every CLI and worker entry leaves the host and lifecycle listeners untouched', () => {
  const paths = [
    'cli/entry.ts', 'cli/run.ts', 'cli/entry-full.ts', 'compiled/run.ts',
    'server/compute-worker.ts', 'server/editor-worker.ts', 'server/query-refresh-worker.ts',
    'server/query-scan-worker.ts', 'server/view-scan-worker.ts',
    'server/test-adapter-vitest.ts', 'server/operation/main.ts',
    'server/compute-worker-main.ts', 'server/editor-worker-main.ts', 'server/query-refresh-worker-main.ts',
    'server/query-scan-worker-main.ts', 'server/view-scan-worker-main.ts',
    'server/test-adapter-vitest-main.ts', 'server/operation/run.ts',
  ].map(path => new URL(`../../src/entry/${path}`, import.meta.url).href);
  const probe = `
    import assert from 'node:assert/strict';
    const listeners = emitter => Object.fromEntries(emitter.eventNames().filter(name => typeof name === 'string').map(name => [name, emitter.listenerCount(name)]));
    const snapshot = () => ({ argv: [...process.argv], cwd: process.cwd(), env: { ...process.env }, process: listeners(process), stdin: listeners(process.stdin), destroyed: process.stdin.destroyed, exitCode: process.exitCode });
    const before = snapshot();
    for (const path of ${JSON.stringify(paths)}) await import(path);
    assert.deepEqual(snapshot(), before);
    console.log('imports complete');
  `;
  assert.deepEqual(invoke(['--eval', probe]), { status: 0, stdout: 'imports complete\n', stderr: '' });
});

// @feature docs/engineering/build/architecture.md#编译入口
test('CLI captures argv on explicit run and dispatch preserves ordinary CLI arguments', () => {
  const expected = invoke([source, '--version']);
  assert.equal(expected.status, 0, expected.stderr);
  const probe = `
    process.argv.splice(2, process.argv.length, '--invalid-before-run');
    const { run } = await import(${JSON.stringify(new URL('../../src/entry/cli/run.ts', import.meta.url).href)});
    process.argv.splice(2, process.argv.length, '--version');
    await run();
  `;
  assert.deepEqual(invoke(['--eval', probe]), expected);
  for (const args of [['--version'], ['--help'], ['--help', '--concord-internal', 'compute-worker'], ['--json', '--concord-internal', 'editor-worker']]) {
    assert.deepEqual(invoke([dispatcher, ...args]), invoke([source, ...args]), JSON.stringify(args));
  }
});

// @feature docs/engineering/build/architecture.md#编译入口
test('dispatch rejects missing, unknown, source-only and arbitrary-path internal names', () => {
  for (const name of [undefined, '', 'unknown', 'web-build', 'workspace-server', '../cli/run.ts']) {
    const result = invoke([dispatcher, '--concord-internal', ...(name === undefined ? [] : [name])]);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(JSON.parse(result.stderr).error, 'UnknownInternalEntry');
  }
});

// @feature docs/engineering/build/architecture.md#编译入口
test('dispatch strips only its two selector arguments before real Vitest collection', () => {
  const project = mkdtempSync(join(tmpdir(), 'concord entry project '));
  try {
    writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'entry-project', type: 'module', private: true }));
    symlinkSync(join(root, 'node_modules'), join(project, 'node_modules'), 'junction');
    const file = join(project, 'sample.test.ts');
    writeFileSync(file, "import { test } from 'vitest'; test('entry argument fixture', () => {});\n");
    for (const [label, entry] of [
      ['source', [join(root, 'src/entry/server/test-adapter-vitest.ts')]],
      ['dispatch', [dispatcher, '--concord-internal', 'test-adapter-vitest']],
    ] as const) {
      const report = join(project, `${label} report.json`);
      const result = invoke([...entry, project, file, report], undefined, project);
      assert.deepEqual(result, { status: 0, stdout: '', stderr: '' });
      assert.deepEqual(JSON.parse(readFileSync(report, 'utf8')), [{ name: 'entry argument fixture', file, project: 'default', tags: {} }]);
    }
  } finally { rmSync(project, { recursive: true, force: true }); }
});

// @feature docs/engineering/build/architecture.md#编译入口
test('selected editor and operation roles run once with the same input and output as source entries', () => {
  for (const [name, path, args] of [
    ['editor-worker', 'server/editor-worker.ts', [root]],
    ['operation-worker', 'server/operation/main.ts', []],
  ] as const) {
    const expected = invoke([join(root, 'src/entry', path), ...args], '{}');
    assert.equal(expected.status, 0, expected.stderr);
    assert.match(expected.stdout, /"ok":false/u);
    const result = invoke([dispatcher, '--concord-internal', name, ...args], '{}');
    assert.deepEqual(result, expected);
    if (name === 'operation-worker') assert.equal(result.stdout.split('{"ready":true}').length - 1, 1);
    else assert.equal(result.stdout.split('"ok":false').length - 1, 1);
  }
});
