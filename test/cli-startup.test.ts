import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { installConcord, packConcord } from './installed-package.js';

const environment: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1', TERM: 'dumb', NODE_OPTIONS: '' };
delete environment.FORCE_COLOR;
const Receipt = Schema.Struct({ stdout: Schema.String, stderr: Schema.String, status: Schema.Int });
const Captures = Schema.Record(Schema.String, Receipt);
const invoke = (entry: string, args: readonly string[], env = environment, cwd?: string) => Effect.tryPromise(() => new Promise<typeof Receipt.Type>((accept, reject) => {
  execFile(process.execPath, [entry, ...args], { env, cwd, encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error && typeof error.code !== 'number') { reject(error); return; }
    accept({ stdout, stderr, status: typeof error?.code === 'number' ? error.code : 0 });
  });
}));
const readCaptures = async () => {
  const location = resolve('dist/startup-data.js');
  const data: { default: { receipts: unknown } } = await import(pathToFileURL(location).href);
  return Schema.decodeUnknownSync(Captures)(data.default.receipts);
};

// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
test('every built and installed static receipt matches the complete CLI byte for byte', () => Effect.runPromise(Effect.gen(function*() {
  const scratch = yield* Effect.sync(() => mkdtempSync(join(tmpdir(), 'concord-startup-parity-')));
  try {
    yield* Effect.sync(() => {
      writeFileSync(join(scratch, 'package.json'), '{"private":true,"type":"module"}');
      installConcord(scratch, packConcord(scratch));
    });
    const captures = yield* Effect.tryPromise(readCaptures);
    assert.ok(Object.keys(captures).length >= 175, 'enumerate definitions rather than a hand-maintained command list');
    for (const distribution of [resolve('dist'), join(scratch, 'node_modules/concord-sdlc/dist')]) {
      yield* Effect.all(Object.entries(captures).map(([key, expected]) => Effect.gen(function*() {
        const args = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.String)))(key);
        const full = yield* invoke(join(distribution, 'entry-full.js'), args);
        const actual = yield* invoke(join(distribution, 'entry.js'), args);
        assert.deepEqual(full, expected, `${distribution}: recorded ${key}`);
        assert.deepEqual(actual, full, `${distribution}: static ${key}`);
      })), { concurrency: 4 });
    }
  } finally { yield* Effect.sync(() => rmSync(scratch, { recursive: true, force: true })); }
})));

// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
test('static help, version, default and repository help load no Effect, command or native code', () => Effect.runPromise(Effect.sync(() => {
  const scratch = mkdtempSync(join(tmpdir(), 'concord-startup-probe-'));
  try {
    for (const [entry, args] of [
      ...[[], ['--version'], ['--help'], ['memory', 'index', '--help'], ['repo', 'docs', '--help']].map(args => [resolve('dist/entry.js'), args] as const),
      [resolve('src/entry.ts'), ['--version']],
    ] as const) {
      const loadedPath = join(scratch, 'loaded.json');
      const result = spawnSync(process.execPath, ['--import', 'tsx', '--import', resolve('test/cli-load-probe.ts'), entry, ...args], {
        env: { ...environment, CONCORD_TEST_LOADED_MODULES: loadedPath }, encoding: 'utf8', timeout: 30_000,
      });
      assert.equal(result.error, undefined);
      const loaded = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.String)))(readFileSync(loadedPath, 'utf8'));
      assert.ok(loaded.some(url => url === pathToFileURL(entry).href));
      assert.ok(loaded.some(url => url.endsWith('/dist/startup-data.js')));
      for (const url of loaded) {
        assert.doesNotMatch(url, /\/(?:effect|@effect\/platform-node)(?:\/|@)/u);
        assert.doesNotMatch(url, /\/dist\/(?:cli(?:[.-]|\.js)|entry-full|repository\/|hawdb)/u);
        assert.doesNotMatch(url, /(?:\.node$|\/mdast-util-from-markdown\/|\/typescript\/)/u);
      }
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md
test('ordinary commands load only their selected top-level command group', () => Effect.runPromise(Effect.sync(() => {
  const scratch = mkdtempSync(join(tmpdir(), 'concord-command-probe-'));
  try {
    for (const [group, args] of [['memory', ['--json', '--root', scratch, 'memory', 'index']], ['template', ['template', 'list', '--json']]] as const) {
      const loadedPath = join(scratch, 'loaded.json');
      const result = spawnSync(process.execPath, ['--import', 'tsx', '--import', resolve('test/cli-load-probe.ts'), resolve('dist/entry.js'), ...args], {
        env: { ...environment, CONCORD_TEST_LOADED_MODULES: loadedPath }, encoding: 'utf8', timeout: 30_000,
      });
      assert.equal(result.error, undefined);
      const loaded = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.String)))(readFileSync(loadedPath, 'utf8'));
      assert.ok(loaded.some(url => url.endsWith(`/dist/cli-command-${group}.js`)));
      assert.ok(!loaded.some(url => url.endsWith('/dist/cli-fallback-bundle.js')));
      for (const url of loaded.filter(url => /\/cli-command-/u.test(url))) assert.ok(url.endsWith(`/cli-command-${group}.js`), url);
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
test('shared flags, unknown inputs, delimiters, completion, skill and source routing retain full CLI semantics', () => Effect.runPromise(Effect.gen(function*() {
  const cases = [
    ['--json', 'unknown'], ['memory', 'unknown', '--json'], ['template', 'list', '--unknown', '--json'],
    ['--json', '--root', '/concord-missing-root', 'memory', 'index'], ['--root=/concord-missing-root', 'memory', 'index', '--json'],
    ['template', 'list', '--json'], ['--json=true', 'template', 'list'], ['template', '--', '--help'],
    ['memory', 'index', '--', '--json'], ['--root', '--help'], ['--unknown', 'template', 'list'],
    ['template', 'list', '-h'], ['template', 'list', '--help=true'], ['memory', '-v'],
    ['--completions', 'bash'], ['template', '--completions=zsh'], ['--json', 'memory', 'show'],
    ['feedback', 'create', 'ignored', '--unknown', '--json'], ['--skill', 'memory'], ['repo', '--help'],
  ];
  yield* Effect.all(cases.map(args => Effect.gen(function*() {
    const full = yield* invoke(resolve('dist/entry-full.js'), args);
    assert.deepEqual(yield* invoke(resolve('dist/entry.js'), args), full, JSON.stringify(args));
  })), { concurrency: 4 });
  for (const args of [[], ['--help'], ['--version']]) {
    assert.deepEqual(yield* invoke(resolve('dist/cli.js'), args), yield* invoke(resolve('dist/entry-full.js'), args), `direct CLI: ${args.join(' ')}`);
  }
  for (const args of [['--version'], ['memory', 'index', '--help'], ['template', 'list', '--json'], ['repo', '--help']]) {
    const full = yield* invoke(resolve('dist/entry-full.js'), args);
    const source = yield* Effect.tryPromise(() => new Promise<typeof Receipt.Type>((accept, reject) => execFile(process.execPath,
      ['--import', 'tsx', resolve('src/entry.ts'), ...args], { env: environment, encoding: 'utf8', timeout: 30_000 }, (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') reject(error);
        else accept({ stdout, stderr, status: typeof error?.code === 'number' ? error.code : 0 });
      })));
    assert.deepEqual(source, full, `source: ${args.join(' ')}`);
  }
})));

// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
test('private installation falls back for missing data, missing or changed modules and installation identity drift', () => Effect.runPromise(Effect.gen(function*() {
  const scratch = yield* Effect.sync(() => mkdtempSync(join(tmpdir(), 'concord-startup-fallback-')));
  try {
    yield* Effect.sync(() => {
      writeFileSync(join(scratch, 'package.json'), '{"private":true,"type":"module"}');
      installConcord(scratch, packConcord(scratch), [], { private: true });
    });
    const packageRoot = join(scratch, 'node_modules/concord-sdlc');
    const entry = join(packageRoot, 'dist/entry.js');
    yield* Effect.sync(() => assert.equal(spawnSync('git', ['init', '--quiet', scratch]).status, 0));
    const initialized = yield* invoke(entry, ['--root', scratch, '--json', 'init', '--docs-only', '--yes']);
    assert.equal(initialized.status, 0, initialized.stderr);
    for (const name of ['startup-data.js', 'cli-command-template.js']) {
      const path = join(packageRoot, 'dist', name);
      yield* Effect.sync(() => renameSync(path, `${path}.saved`));
      try {
        for (const args of [['--help'], ['--version'], ['template', 'list', '--json'], ['--root', scratch, '--json', 'memory', 'index']]) {
          assert.deepEqual(yield* invoke(entry, args), yield* invoke(join(packageRoot, 'dist/entry-full.js'), args), `missing ${name}`);
        }
      } finally { yield* Effect.sync(() => renameSync(`${path}.saved`, path)); }
    }
    const dataPath = join(packageRoot, 'dist/startup-data.js');
    const dataBytes = yield* Effect.sync(() => readFileSync(dataPath));
    try {
      yield* Effect.sync(() => writeFileSync(dataPath, 'export default null;\n'));
      assert.deepEqual(yield* invoke(entry, ['--help']), yield* invoke(join(packageRoot, 'dist/entry-full.js'), ['--help']));
    } finally { yield* Effect.sync(() => writeFileSync(dataPath, dataBytes)); }
    for (const name of ['dist/cli-command-template.js', 'dist/repository/docs/work/command.js', 'package.json']) {
      const path = join(packageRoot, name);
      const before = yield* Effect.sync(() => readFileSync(path));
      try {
        yield* Effect.sync(() => name.endsWith('.js') ? appendFileSync(path, '\n// changed module\n') : writeFileSync(path, JSON.stringify({ ...Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))(before.toString()), version: 'startup-test' })));
        for (const args of [['--version'], ['template', 'list', '--json']]) {
          assert.deepEqual(yield* invoke(entry, args), yield* invoke(join(packageRoot, 'dist/entry-full.js'), args), `changed ${name}`);
        }
      } finally { yield* Effect.sync(() => writeFileSync(path, before)); }
    }
    const noncanonical: NodeJS.ProcessEnv = { ...environment, TERM: 'xterm', FORCE_COLOR: '1' };
    delete noncanonical.NO_COLOR;
    assert.deepEqual(yield* invoke(entry, ['--help'], noncanonical), yield* invoke(join(packageRoot, 'dist/entry-full.js'), ['--help'], noncanonical));
    for (const env of [{ ...environment, NODE_DISABLE_COMPILE_CACHE: '1' }, { ...environment, NODE_COMPILE_CACHE: '/dev/null/concord-cache' }]) {
      assert.deepEqual(yield* invoke(entry, ['template', 'list', '--json'], env), yield* invoke(join(packageRoot, 'dist/entry-full.js'), ['template', 'list', '--json'], env));
    }
  } finally { yield* Effect.sync(() => rmSync(scratch, { recursive: true, force: true })); }
})));
