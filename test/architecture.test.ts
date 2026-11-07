import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Effect } from 'effect';
import { dependencyViolations, inspectArchitecture, inspectTestLayout } from './support/architecture.ts';

const root = fileURLToPath(new URL('../', import.meta.url));

// @feature docs/engineering/code/README.md#模块与文件
test('source index files only export their module interfaces', async () => (await Effect.runPromise(Effect.tryPromise(async () => {
  const audit = (await inspectArchitecture(root, new Map([
    ['src/model/index.ts', 'export { ready } from "./ready.ts"; export type { Ready } from "./ready.ts";'],
    ['src/model/ready.ts', 'export const ready = true; export type Ready = boolean;'],
    ['src/app/index.ts', 'import { ready } from "../model/index.ts"; export const active = ready;'],
  ])));
  assert.deepEqual(audit.invalid.filter(item => item.code === 'IndexImplementation').map(item => item.file), ['src/app/index.ts', 'src/app/index.ts']);
  assert.deepEqual((await inspectArchitecture(root)).invalid.filter(item => item.code === 'IndexImplementation'), []);
}))));

// @feature docs/engineering/testing/architecture.md#架构守护
test('source import and export graphs obey module exits, layers, domain order and composition roots', async () => (await Effect.runPromise(Effect.tryPromise(async () => {
  const audit = (await inspectArchitecture(root));
  assert.deepEqual(dependencyViolations(audit), []);
}))));

// @feature docs/engineering/testing/architecture.md#架构守护
test('model, domain and application code access platform capabilities through services', async () => (await Effect.runPromise(Effect.tryPromise(async () => {
  assert.deepEqual((await inspectArchitecture(root)).platform, []);
}))));

// @feature docs/engineering/testing/architecture.md#架构守护
test('domain and application consumers cannot open persistent cache handles or select their own access mode', async () => (await Effect.runPromise(Effect.tryPromise(async () => {
  const audit = (await inspectArchitecture(root));
  assert.deepEqual(audit.edges.filter(edge => /^src\/(?:domain|app)\//u.test(edge.from)
    && edge.to === 'src/base/cache/index.ts'
    && edge.bindings.some(name => name === 'openHawdb' || name === 'withPersistentCache')), []);
}))));

// @feature docs/engineering/testing/architecture.md#架构守护
test('architecture audit sees type exports, finite dynamic imports and aliased process capabilities', async () => (await Effect.runPromise(Effect.tryPromise(async () => {
  const sources = new Map([
    ['src/model/index.ts', 'export type { Hidden } from "../domain/documents/index.js";'],
    ['src/domain/documents/index.ts', 'import type { BadDirection } from "../issues/index.js"; export interface Hidden { readonly name: string }'],
    ['src/domain/issues/index.ts', 'import type { Hidden } from "../documents/index.js"; export interface BadDirection { readonly item: Hidden }; const runtime = process; const { env: settings } = runtime; runtime["stdout"].write("x"); const target = settings.TERM ? "../documents/index.js" : "../../app/index.js"; void import(target);'],
    ['src/app/index.ts', 'export const ready = true;'],
  ]);
  const audit = (await inspectArchitecture(root, sources));
  assert.deepEqual(audit.edges.filter(edge => edge.from === 'src/domain/issues/index.ts' && edge.kind === 'dynamic').map(edge => edge.to).sort(), ['src/app/index.ts', 'src/domain/documents/index.ts']);
  assert.ok(audit.edges.some(edge => edge.kind === 'export' && edge.typeOnly));
  assert.ok(audit.edges.some(edge => edge.kind === 'import' && edge.typeOnly));
  assert.deepEqual(new Set(audit.platform.map(item => item.code)), new Set(['ProcessDestructure', 'ProcessCapability']));
  assert.ok(dependencyViolations(audit).some(item => item.code === 'LayerDirection'));
  assert.ok(dependencyViolations(audit).some(item => item.code === 'DomainOrder' && item.file === 'src/domain/documents/index.ts' && item.text.startsWith('import type:')));
  const opaque = (await inspectArchitecture(root, new Map([['src/app/load.ts', 'export const load = (path: string) => import(path);']])));
  assert.deepEqual(opaque.invalid.map(item => item.code), ['UnenumerableDynamicImport']);
}))));

// @feature docs/engineering/testing/architecture.md#架构守护
test('synthetic CLI host guard follows aliases, destructuring, computed members and process imports', async () => (await Effect.runPromise(Effect.tryPromise(async () => {
  const audit = (await inspectArchitecture(root, new Map([
    ['src/entry/cli/unsafe.ts', `import host from 'node:process';
      import * as native from 'node:process';
      import { env as settings, once as listen } from 'node:process';
      const alias = host; const key = 'std' + 'out'; alias[key].write('x');
      const { cwd: current, ['argv']: args } = native; current();
      const { env: { HOME } } = process;
      const { process: p } = globalThis; p.exitCode = 1;
      let assigned; assigned = host; assigned.stderr.write('x');
      let captured; ({ env: captured } = host);
      host[chooseMember()];
      const { on: subscribe } = alias; subscribe('SIGTERM', () => {});
      const again = listen; again('SIGINT', () => {});
      const bound = host.on.bind(host); bound('SIGQUIT', () => {});
      native.once.call(native, 'SIGHUP', () => {}); void settings; void args; void HOME;`],
    ['src/entry/cli/run.ts', `process.env.HOME; process.cwd(); process.argv; process.on('SIGINT', () => {}); process.exit(0);`],
    ['src/entry/cli/safe.ts', `import host, { pid, execPath } from 'node:process';
      void host.pid; void host.execPath; void pid; void execPath; host.on('exit', () => {});`],
    ['src/base/example.ts', 'process.env.HOME; process.on("SIGINT", () => {});'],
    ['src/entry/server/example.ts', 'process.env.HOME;'],
  ])));
  assert.deepEqual(new Set(audit.platform.map(item => item.file)), new Set(['src/entry/cli/unsafe.ts']));
  assert.deepEqual(new Set(audit.platform.map(item => item.code)), new Set(['CliHostProcessCapability', 'CliHostProcessDestructure', 'CliHostProcessImport', 'CliHostSignalListener', 'UnenumerableCliHostMember']));
  assert.equal(audit.platform.filter(item => item.code === 'CliHostSignalListener').length, 4);
  assert.ok(audit.platform.some(item => item.text.includes('env: { HOME }')));
}))));

// @feature docs/engineering/testing/architecture.md#架构守护
test('synthetic layout guard follows called helpers and reexports to a CLI launch', async () => (await Effect.runPromise(Effect.tryPromise(async () => {
  const violations = (await inspectTestLayout(root, new Map([
    ['test/cli/example.test.ts', `import test from 'node:test'; import { call } from '../support/barrel.ts'; test('command', () => { const query = () => call(); query(); });`],
    ['test/support/barrel.ts', `export { invoke as call } from './wrapper.ts';`],
    ['test/support/wrapper.ts', `import { launch } from './launcher.ts'; import { installedConcordCli } from './paths.ts'; export function invoke() { return launch(installedConcordCli()); }`],
    ['test/support/paths.ts', `import { join } from 'node:path'; export const sourceCli = () => join('/checkout', 'src/entry/cli/entry.ts'); export const installedConcordCli = () => sourceCli();`],
    ['test/support/launcher.ts', `import { spawn as child } from 'node:child_process'; export const launch = (cli: string) => child(process.execPath, [cli, '--version']);`],
  ])));
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.code, 'CliHostProcess');
  assert.equal(violations[0]?.file, 'test/support/launcher.ts');
  assert.match(violations[0]?.text ?? '', /called by test\/cli\/example.test.ts/u);
}))));

// @feature docs/engineering/testing/architecture.md#架构守护
test('synthetic layout guard observes Effect spawners and rejects unknown actual Node targets', async () => (await Effect.runPromise(Effect.tryPromise(async () => {
  const violations = (await inspectTestLayout(root, new Map([
    ['test/cli/example.test.ts', `import test from 'node:test'; import { Effect } from 'effect'; import { ChildProcess, ChildProcessSpawner } from 'effect/process';
      import * as E from 'effect/Effect'; import * as CP from 'effect/process/ChildProcess';
      import { execFile, fork } from 'node:child_process';
      test('command', () => Effect.runPromise(Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        yield* spawner.exitCode(ChildProcess.make(process.execPath, ['/checkout/src/entry/cli/entry.ts', '--version']));
      })));
      test('namespace command', () => E.runPromise(E.gen(function* () { const spawner = yield* ChildProcessSpawner.ChildProcessSpawner; yield* spawner.string(CP.make('node', ['/checkout/src/entry/cli/entry.ts'])); })));
      test('unknown Effect command', () => Effect.runPromise(Effect.gen(function* () { const spawner = yield* ChildProcessSpawner.ChildProcessSpawner; yield* spawner.spawn(chooseCommand()); })));
      test('unknown', () => { const target = chooseTarget(); execFile(process.execPath, [target, '--version']); });
      test('fork', () => fork('/checkout/src/entry/cli/entry.ts'));`],
  ])));
  assert.equal(violations.filter(item => item.code === 'CliHostProcess').length, 3);
  assert.equal(violations.filter(item => item.code === 'UnenumerableCliTarget').length, 2);
}))));

// @feature docs/engineering/testing/architecture.md#架构守护
test('synthetic layout guard permits Git preparation, read helpers and runCli without scanning unused spawns', async () => (await Effect.runPromise(Effect.tryPromise(async () => {
  assert.deepEqual((await inspectTestLayout(root, new Map([
    ['test/cli/example.test.ts', `import test from 'node:test'; import { setup, readPage, unused } from '../support/helpers.ts';
      import { runCli } from '../support/cli.ts'; import type { unusedType } from '../support/helpers.ts';
      test('command', async () => { setup(); readPage('src/entry/cli/entry.ts'); await runCli({ argv: ['check'] }); });`],
    ['test/support/helpers.ts', `import { spawnSync } from 'node:child_process'; import { readFileSync } from 'node:fs';
      export const unused = () => spawnSync(process.execPath, ['/checkout/src/entry/cli/entry.ts']);
      export const setup = () => { spawnSync('git', ['add', 'src/entry/cli/entry.ts']); spawnSync(process.execPath, ['tool.ts', 'src/entry/cli/entry.ts']); };
      export const readPage = (path: string) => readFileSync(path, 'utf8');`],
    ['test/support/cli.ts', `export const runCli = () => { throw new Error('product boundary must not be evaluated'); };`],
  ]))), []);
}))));

// @feature docs/engineering/testing/architecture.md#架构守护
test('synthetic layout guard checks Node preloads and every possible script target', async () => (await Effect.runPromise(Effect.tryPromise(async () => {
  const violations = (await inspectTestLayout(root, new Map([
    ['test/cli/example.test.ts', `import test from 'node:test'; import { execPath as node } from 'node:process'; import cp from 'node:child_process';
      test('unknown branch', () => cp.execFile(node, choose() ? ['tool.ts'] : [chooseTarget()]));
      test('preload', () => cp.spawn(node, ['--import=/checkout/src/entry/cli/entry.ts', 'tool.ts']));
      test('worker', () => cp.spawn(node, ['--conditions', 'concord-source', '/checkout/src/entry/server/compute-entry.ts']));`],
  ])));
  assert.deepEqual(violations.map(item => item.code), ['UnenumerableCliTarget', 'CliHostProcess']);
}))));

const executorLayout = (invocation: string): Map<string, string> => new Map([
  ['test/cli/example.test.ts', `import test from 'node:test'; import { runCli } from '../support/cli.ts'; import { smoke } from '../support/smoke.ts'; test('ordinary', () => { ${invocation} });`],
  ['test/support/smoke.ts', `import { prepare } from '../../scripts/perf/workspace.ts'; import { makeContext } from '../../scripts/perf/scenario.ts';
    export function smoke(executeCli = undefined) {
      prepare({ entry: '/checkout/src/entry/cli/entry.ts', ...(executeCli ? { executeCli } : {}) });
      const context = makeContext(executeCli); context.cli();
    }`],
  ['scripts/perf/workspace.ts', `import { fixture } from '../../bench/fixtures/index.ts'; export const prepare = options => fixture(options);`],
  ['bench/fixtures/index.ts', `import { launch } from '../../scripts/perf/launcher.ts';
    export function fixture({ executeCli, entry }) { if (executeCli) return executeCli({ argv: ['init'] }); return launch(entry); }`],
  ['scripts/perf/scenario.ts', `import { launch } from './launcher.ts';
    export const makeContext = executeCli => ({ cli: () => executeCli ? executeCli({ argv: ['check'] }) : launch('/checkout/src/entry/cli/entry.ts') });`],
  ['scripts/perf/launcher.ts', `import { spawn } from 'node:child_process'; export const launch = entry => spawn(process.execPath, [entry]);`],
]);

// @feature docs/engineering/testing/architecture.md#架构守护
test('synthetic layout guard proves explicit runCli injection across bench options and returned context', async () => (await Effect.runPromise(Effect.tryPromise(async () => {
  const sources = executorLayout('const executor = runCli; smoke(executor);');
  const directory = mkdtempSync(join(tmpdir(), 'concord-layout-executor-'));
  try {
    for (const [file, source] of sources) { const path = join(directory, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, source); }
    // Read the real directory inventory too, so bench cannot silently become an external boundary.
    assert.deepEqual((await inspectTestLayout(directory)), []);
    assert.deepEqual((await inspectTestLayout(root, sources)), []);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}))));

// @feature docs/engineering/testing/architecture.md#架构守护
test('synthetic layout guard rejects the default CLI host without executor injection including bench helpers', async () => (await Effect.runPromise(Effect.tryPromise(async () => {
  const sources = executorLayout('smoke();');
  const violations = (await inspectTestLayout(root, sources));
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.code, 'CliHostProcess');
  assert.equal(violations[0]?.file, 'scripts/perf/launcher.ts');
  // Remove the other launch path: the bench helper alone must still be inspected.
  sources.set('scripts/perf/scenario.ts', 'export const makeContext = executeCli => ({ cli: () => undefined });');
  const directory = mkdtempSync(join(tmpdir(), 'concord-layout-default-'));
  try {
    for (const [file, source] of sources) { const path = join(directory, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, source); }
    assert.deepEqual((await inspectTestLayout(directory)).map(item => item.code), ['CliHostProcess']);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}))));

// @feature docs/engineering/testing/architecture.md#架构守护
test('synthetic layout guard retains unknown executor branches and unknown object overrides', async () => (await Effect.runPromise(Effect.tryPromise(async () => {
  for (const invocation of ['smoke(choose() ? runCli : undefined);', 'smoke(choose());']) {
    assert.deepEqual((await inspectTestLayout(root, executorLayout(invocation))).map(item => item.code), ['CliHostProcess']);
  }
  const sources = executorLayout('smoke(runCli);');
  sources.set('test/support/smoke.ts', `import { prepare } from '../../scripts/perf/workspace.ts';
    export const smoke = executeCli => prepare({ entry: '/checkout/src/entry/cli/entry.ts', executeCli, ...unknownOptions() });`);
  assert.deepEqual((await inspectTestLayout(root, sources)).map(item => item.code), ['CliHostProcess']);
}))));

// @feature docs/engineering/testing/architecture.md#架构守护
test('synthetic layout guard propagates executor choices through Effect functions and rest argv', async () => (await Effect.runPromise(Effect.tryPromise(async () => {
  const sources = executorLayout('smoke(runCli);');
  sources.set('test/support/smoke.ts', `import { Effect } from 'effect'; import { prepare } from '../../scripts/perf/workspace.ts';
    export const smoke = Effect.fn('smoke')(function* (executeCli) { yield* prepare({ executeCli, entry: '/checkout/src/entry/cli/entry.ts' }); });`);
  sources.set('scripts/perf/workspace.ts', `import { Effect } from 'effect'; import { fixture } from '../../bench/fixtures/index.ts';
    export const prepare = Effect.fn('prepare')(function* (options) { yield* fixture(options.entry, options.executeCli); });`);
  sources.set('bench/fixtures/index.ts', `import { Effect } from 'effect'; import { launch } from '../../scripts/perf/launcher.ts';
    export const fixture = Effect.fn('fixture')(function* (entry, executeCli) {
      const cli = (...argv) => executeCli ? executeCli({ argv }) : launch(process.execPath, entry, ...argv);
      yield* cli('check');
    });`);
  sources.set('scripts/perf/launcher.ts', `import { Effect } from 'effect'; import { ChildProcess, ChildProcessSpawner } from 'effect/process';
    export const launch = Effect.fn('launch')(function* (...argv) {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      yield* spawner.spawn(ChildProcess.make(argv[0], argv.slice(1)));
    });`);
  assert.deepEqual((await inspectTestLayout(root, sources)), []);
  sources.set('test/cli/example.test.ts', `import { smoke } from '../support/smoke.ts'; smoke();`);
  assert.deepEqual((await inspectTestLayout(root, sources)).map(item => item.code), ['CliHostProcess']);
}))));

// @feature docs/engineering/testing/architecture.md#架构守护
test('synthetic layout guard rejects package-manager CLI launches while allowing installs and other scripts', async () => (await Effect.runPromise(Effect.tryPromise(async () => {
  const sources = new Map<string, string>();
  for (const manager of ['pnpm', 'npm', 'yarn', 'bun', 'npx']) for (const mode of ['', 'exec', 'run']) {
    const argv = [...(mode ? [mode] : []), 'concord', '--version'];
    sources.set(`test/cli/${manager}-${mode || 'direct'}.test.ts`, `import { spawnSync } from 'node:child_process'; spawnSync('${manager}', ${JSON.stringify(argv)});`);
  }
  sources.set('test/cli/flags.test.ts', `import { execFile } from 'node:child_process'; execFile('/usr/bin/pnpm', ['--dir', '/checkout', '--silent', 'exec', '--', 'concord', '--version']);`);
  sources.set('test/cli/package-version.test.ts', `import { spawn } from 'node:child_process'; spawn('npx', ['--yes', 'concord-sdlc@latest', '--version']);`);
  const violations = (await inspectTestLayout(root, sources));
  assert.equal(violations.length, 17);
  assert.ok(violations.every(item => item.code === 'CliHostProcess'));
  assert.deepEqual((await inspectTestLayout(root, new Map([
    ['test/cli/install.test.ts', `import { spawnSync } from 'node:child_process';
      spawnSync('pnpm', ['install', 'concord-sdlc']); spawnSync('npm', ['install', 'concord']); spawnSync('yarn', ['add', 'concord-sdlc']);
      spawnSync('bun', ['run', 'tool.ts']); spawnSync('npx', ['--yes', 'other-tool', 'concord']);
      spawnSync(process.execPath, ['tool.ts', 'concord']);`],
  ]))), []);
  assert.deepEqual((await inspectTestLayout(root, new Map([
    ['test/cli/unknown.test.ts', `import { spawnSync } from 'node:child_process';
      spawnSync('pnpm', choose() ? ['install'] : unknownArguments());
      spawnSync('npm', ['exec', unknownCommand()]);`],
  ]))).map(item => item.code), ['UnenumerableCliTarget', 'UnenumerableCliTarget']);
}))));

// @feature docs/engineering/testing/architecture.md#架构守护
test('synthetic process layout accepts eight guarantee categories and rejects missing, late, empty or unknown declarations', async () => (await Effect.runPromise(Effect.tryPromise(async () => {
  const categories = ['进程终止与信号', 'OS 锁与互斥', '服务与 IPC', '文件监听', '外部程序', '原生模块与句柄', '运行环境', '网络'];
  const sources = new Map(categories.map((category, index) => [`test/process/${index}.test.ts`, `/* 跨进程保证：${category}——等待真实子进程退出后释放资源。 */\nimport test from 'node:test';`]));
  sources.set('test/process/support.ts', 'export const fixture = true;');
  assert.deepEqual((await inspectTestLayout(root, sources)), []);
  sources.set('test/process/missing.test.ts', `import test from 'node:test';`);
  sources.set('test/process/late.test.ts', `import test from 'node:test'; // 跨进程保证：网络——真实连接已关闭`);
  sources.set('test/process/empty.test.ts', '// 跨进程保证：网络——');
  sources.set('test/process/unknown.test.ts', '// 跨进程保证：任意类别——真实连接已关闭');
  assert.deepEqual((await inspectTestLayout(root, sources)).map(item => [item.file, item.code]), [
    ['test/process/empty.test.ts', 'InvalidProcessGuarantee'],
    ['test/process/late.test.ts', 'MissingProcessGuarantee'],
    ['test/process/missing.test.ts', 'MissingProcessGuarantee'],
    ['test/process/unknown.test.ts', 'InvalidProcessGuarantee'],
  ]);
}))));

// @feature docs/engineering/testing/architecture.md#架构守护
test('CLI tests use the command program and process tests declare their cross-process guarantee', async () => (await Effect.runPromise(Effect.tryPromise(async () => {
  assert.deepEqual((await inspectTestLayout(root)), []);
}))));
