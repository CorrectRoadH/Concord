import { installationResources } from "../../src/base/installation/index.js";
import { packageBin } from '../../scripts/package-location.js';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.js';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { before, after } from 'node:test';
import { Effect, Schema } from 'effect';
import { fullCommand } from "../../src/entry/cli/index.js";
import { installConcord, packConcord } from '../support/installed-package.js';

const environment: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1', TERM: 'dumb', NODE_OPTIONS: '', NODE_DISABLE_COMPILE_CACHE: '1' };
delete environment.FORCE_COLOR;
const scratch = mkdtempSync(join(tmpdir(), 'concord-startup-'));
let packageRoot: string, entry: string;
before(() => {
  const install = join(scratch, 'install'); mkdirSync(install); writeFileSync(join(install, 'package.json'), '{"private":true,"type":"module"}');
  installConcord(install, packConcord(scratch), [], { private: true });
  packageRoot = join(install, 'node_modules/concord-sdlc'); entry = packageBin(packageRoot);
});
after(() => rmSync(scratch, { recursive: true, force: true }));
const invoke = (args: readonly string[]) => Effect.tryPromise(() => new Promise<{ stdout: string; stderr: string; status: number }>((accept, reject) => {
  execFile(process.execPath, [entry, ...args], { env: environment, encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error && typeof error.code !== 'number') { reject(error); return; }
    accept({ stdout, stderr, status: typeof error?.code === 'number' ? error.code : 0 });
  });
}));
interface Definition { readonly name: string; readonly subcommands: readonly { readonly commands: readonly Definition[] }[] }
const helpCalls: readonly string[][] = (() => {
  const paths: string[][] = [];
  const visit = (command: Definition, path: string[]) => { paths.push([...path, '--help']); for (const group of command.subcommands) for (const child of group.commands) visit(child, [...path, child.name]); };
  visit(fullCommand as unknown as Definition, []); return [[], ['--version'], ...paths];
})();

// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
test('installed static help enumerates the actual commands and matches the public fallback bin byte for byte', () => Effect.runPromise(Effect.gen(function* () {
  const expected = yield* Effect.all(helpCalls.map(args => invoke(args)), { concurrency: 4 });
  const path = installationResources(packageRoot).help; renameSync(path, `${path}.saved`);
  try {
    const fallback = yield* Effect.all(helpCalls.map(args => invoke(args)), { concurrency: 4 });
    for (let index = 0; index < helpCalls.length; index++) {
      assert.equal(expected[index]!.status, helpCalls[index]!.length === 0 ? 1 : 0, JSON.stringify({ args: helpCalls[index], actual: expected[index] }));
      assert.deepEqual(fallback[index], expected[index], JSON.stringify(helpCalls[index]));
    }
  } finally { renameSync(`${path}.saved`, path); }
})));

// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
test('installed help and version load the generated data without Effect, commands or native modules', () => {
  for (const args of [[], ['--version'], ['--help'], ['memory', 'index', '--help'], ['test', 'verify', '--help'], ['check', '--help']]) {
    const path = join(scratch, 'loaded.json');
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--import', resolve('test/support/cli-load-probe.ts'), entry, ...args], { env: { ...environment, CONCORD_TEST_LOADED_MODULES: path }, encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, args.length === 0 ? 1 : 0, JSON.stringify({ args, stdout: result.stdout, stderr: result.stderr }));
    const loaded = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.String)))(readFileSync(path, 'utf8'));
    assert.ok(loaded.includes(pathToFileURL(realpathSync(entry)).href), JSON.stringify(loaded));
    assert.ok(loaded.some(url => url === pathToFileURL(realpathSync(installationResources(packageRoot).help)).href));
    for (const url of loaded) {
      assert.doesNotMatch(url, /\/(?:effect|@effect\/platform-node)(?:\/|@)/u);
      assert.doesNotMatch(url, /\/(?:cli-command-[^/]+|entry-full|hawdb-native)\.js$/u);
      assert.doesNotMatch(url, /(?:\.node$|\/mdast-util-from-markdown\/|\/typescript\/)/u);
    }
  }
});

// @use-case docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md
test('installed ordinary commands load only their selected command group', () => {
  for (const [group, args] of [['memory', ['--json', '--root', scratch, 'memory', 'index']], ['template', ['template', 'list', '--json']]] as const) {
    const path = join(scratch, 'loaded.json');
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--import', resolve('test/support/cli-load-probe.ts'), entry, ...args], { env: { ...environment, CONCORD_TEST_LOADED_MODULES: path }, encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.error, undefined);
    const loaded = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.String)))(readFileSync(path, 'utf8'));
    assert.ok(loaded.some(url => url === pathToFileURL(realpathSync(installationResources(packageRoot).command(group))).href));
    assert.ok(!loaded.some(url => url === pathToFileURL(realpathSync(installationResources(packageRoot).fallback)).href));
    for (const url of loaded.filter(url => /\/cli-command-/u.test(url))) assert.ok(url.endsWith(`/cli-command-${group}.js`), url);
  }
});

// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
test('installed routing preserves flags, unknown inputs, delimiters, completion and skills', () => Effect.runPromise(Effect.gen(function* () {
  const calls = [
    ['--json', 'unknown'], ['memory', 'unknown', '--json'], ['template', 'list', '--unknown', '--json'],
    ['--json', '--root', '/concord-missing-root', 'memory', 'index'], ['--root=/concord-missing-root', 'memory', 'index', '--json'],
    ['template', 'list', '--json'], ['--json=true', 'template', 'list'], ['template', '--', '--help'],
    ['memory', 'index', '--', '--json'], ['--root', '--help'], ['--unknown', 'template', 'list'],
    ['template', 'list', '-h'], ['template', 'list', '--help=true'], ['memory', '-v'],
    ['--completions', 'bash'], ['template', '--completions=zsh'], ['--json', 'show', 'missing'], ['--skill', 'memory'],
  ];
  const expected = yield* Effect.all(calls.map(args => invoke(args)), { concurrency: 4 });
  const path = installationResources(packageRoot).help; renameSync(path, `${path}.saved`);
  try {
    const fallback = yield* Effect.all(calls.map(args => invoke(args)), { concurrency: 4 });
    for (let index = 0; index < calls.length; index++) assert.deepEqual(fallback[index], expected[index], JSON.stringify(calls[index]));
  } finally { renameSync(`${path}.saved`, path); }
})));

// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
test('missing or changed installed startup assets preserve public command results', () => Effect.runPromise(Effect.gen(function* () {
  const args = ['template', 'list', '--json']; const expected = yield* invoke(args);
  for (const path of [installationResources(packageRoot).help, installationResources(packageRoot).command('template')]) {
    const name = path; renameSync(path, `${path}.saved`);
    try { assert.deepEqual(yield* invoke(args), expected, `missing ${name}`); }
    finally { renameSync(`${path}.saved`, path); }
  }
  const path = installationResources(packageRoot).command('template'); const before = readFileSync(path);
  try { appendFileSync(path, '\n// changed installed module\n'); assert.deepEqual(yield* invoke(args), expected); }
  finally { writeFileSync(path, before); }
})));

// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
test('help preserves terminal rendering and rejects mismatched generated data', () => {
  const manifest = installationResources(packageRoot).help;
  const original = readFileSync(manifest, 'utf8');
  const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const run = (args: readonly string[], env: NodeJS.ProcessEnv, tty: boolean) => {
    const command = [process.execPath, entry, ...args];
    const result = spawnSync(tty ? 'script' : process.execPath,
      tty ? process.platform === 'darwin' ? ['-q', '/dev/null', ...command] : ['-q', '-e', '-c', command.map(shellQuote).join(' '), '/dev/null'] : [entry, ...args],
      { env, encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.error, undefined);
    return { stdout: result.stdout, stderr: result.stderr, status: result.status };
  };
  for (const [term, tty, color] of [['dumb', false, undefined], ['xterm-256color', false, undefined], ['xterm-256color', true, undefined], ['dumb', false, '1']] as const) {
    const env = { ...environment, TERM: term, FORCE_COLOR: color, NODE_NO_WARNINGS: '1' };
    for (const args of [['--help'], ['memory', 'index', '--help'], ['--version']]) {
      const expected = run(args, env, tty);
      assert.equal(expected.status, 0, JSON.stringify(expected));
      renameSync(manifest, `${manifest}.saved`);
      try { assert.deepEqual(run(args, env, tty), expected, JSON.stringify({ term, tty, color, args })); }
      finally { renameSync(`${manifest}.saved`, manifest); }
    }
  }
  const expected = run(['--help'], environment, false);
  const fallback = installationResources(packageRoot).fallback;
  const fallbackBytes = readFileSync(fallback);
  try {
    appendFileSync(fallback, '\n// changed complete fallback bytes\n');
    assert.deepEqual(run(['--help'], environment, false), expected, 'complete fallback identity');
  } finally { writeFileSync(fallback, fallbackBytes); }
  const start = original.indexOf('export default ') + 'export default '.length;
  const payload = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))(original.slice(start).trim().replace(/;$/u, ''));
  const receipts = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Struct({ stdout: Schema.String, stderr: Schema.String, status: Schema.Int })))(payload.receipts);
  const corrupted = `export default ${JSON.stringify({ ...payload, receipts: { ...receipts, '["--help"]': { ...receipts['["--help"]']!, stdout: 'CORRUPTED_HELP\n' } } })};\n`;
  for (const key of ['packageDigest', 'dataDigest', 'receipt']) {
    try {
      writeFileSync(manifest, key === 'receipt' ? corrupted : original.replace(new RegExp(`"${key}":"[a-f0-9]+"`, 'u'), `"${key}":"${'0'.repeat(64)}"`));
      assert.deepEqual(run(['--help'], environment, false), expected, key);
    } finally { writeFileSync(manifest, original); }
  }
});
