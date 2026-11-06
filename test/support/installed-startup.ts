import { installationResources } from "../../src/base/installation/index.ts";
import { applicationRoot, packageBin } from './installed-package.ts';
import { packageCommand } from '../../scripts/package-command.ts';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile, spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Effect, Schema } from 'effect';
import { fullCommand } from "../../src/entry/cli/index.ts";

const environment: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1', TERM: 'dumb', NODE_OPTIONS: '', NODE_DISABLE_COMPILE_CACHE: '1' };
delete environment.FORCE_COLOR;
export async function verifyInstalledStartup(packageRoot: string, scratch: string): Promise<void> {
const entry = packageBin(packageRoot);
const [command, ...prefix] = packageCommand(entry);
const applicationEntry = join(applicationRoot(packageRoot), 'dist/entry/cli/entry.js');
const runtime = join(packageRoot, 'runtime/node');
const replace = (path: string, bytes: string | Buffer) => { writeFileSync(`${path}.pending`, bytes); renameSync(`${path}.pending`, path); };
const checks: { name: string; run: () => void | Promise<void> }[] = [];
const test = (name: string, run: () => void | Promise<void>) => { checks.push({ name, run }); };
const invoke = (args: readonly string[]) => Effect.tryPromise(() => new Promise<{ stdout: string; stderr: string; status: number }>((accept, reject) => {
  execFile(command, [...prefix, ...args], { cwd: scratch, env: environment, encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
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
test('installed startup data authenticates the final package manifest including gitHead', () => {
  const manifest = readFileSync(join(applicationRoot(packageRoot), 'package.json'));
  const generated = readFileSync(installationResources(packageRoot).help, 'utf8');
  const start = generated.indexOf('export default ') + 'export default '.length;
  const payload = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ packageDigest: Schema.String })), { onExcessProperty: 'ignore' })(generated.slice(start).trim().replace(/;$/u, ''));
  const actual = createHash('sha256').update(manifest).digest('hex');
  assert.equal(payload.packageDigest, actual, JSON.stringify({ expectedPackageDigest: payload.packageDigest, actualManifestDigest: actual }));
});

// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
test('installed static help enumerates the actual commands and matches the public fallback bin byte for byte', () => Effect.runPromise(Effect.gen(function* () {
  const expected = yield* Effect.all(helpCalls.map(args => invoke(args)), { concurrency: 4 });
  const path = installationResources(packageRoot).help; renameSync(path, `${path}.saved`);
  try {
    const fallback = yield* Effect.all(helpCalls.map(args => invoke(args)), { concurrency: 4 });
    for (let index = 0; index < helpCalls.length; index++) {
      assert.equal(expected[index]!.status, helpCalls[index]!.length === 0 ? 1 : 0, JSON.stringify({ args: helpCalls[index], actual: expected[index] }));
      assert.deepEqual(fallback[index], expected[index], JSON.stringify(helpCalls[index]));
      const args = helpCalls[index]!;
      if (args.at(-1) === '--help') {
        const usage = `concord${args.length === 1 ? '' : ` ${args.slice(0, -1).join(' ')}`}`;
        const actual = /(?:^|\n)USAGE\n\s+([^\n]+)/u.exec(expected[index]!.stdout)?.[1];
        assert.ok(actual === usage || actual?.startsWith(`${usage} `), JSON.stringify({ args, actual }));
      }
    }
  } finally { renameSync(`${path}.saved`, path); }
})));

// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
test('installed help and version load the generated data without Effect, commands or native modules', () => {
  for (const args of [[], ['--version'], ['--help'], ['memory', 'search', '--help'], ['test', 'verify', '--help'], ['check', '--help']]) {
    const path = join(scratch, 'loaded.json');
    const result = spawnSync(runtime, ['--import', resolve('test/support/cli-load-probe.ts'), applicationEntry, ...args], { env: { ...environment, CONCORD_TEST_LOADED_MODULES: path }, encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, args.length === 0 ? 1 : 0, JSON.stringify({ args, stdout: result.stdout, stderr: result.stderr }));
    const loaded = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.String)))(readFileSync(path, 'utf8'));
    assert.ok(loaded.includes(pathToFileURL(realpathSync(applicationEntry)).href), JSON.stringify(loaded));
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
  for (const [group, args] of [['memory', ['--json', '--root', scratch, 'memory', 'search', 'cache']], ['template', ['template', 'list', '--json']]] as const) {
    const path = join(scratch, 'loaded.json');
    const result = spawnSync(runtime, ['--import', resolve('test/support/cli-load-probe.ts'), applicationEntry, ...args], { env: { ...environment, CONCORD_TEST_LOADED_MODULES: path }, encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.error, undefined);
    const loaded = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.String)))(readFileSync(path, 'utf8'));
    assert.ok(loaded.some(url => url === pathToFileURL(realpathSync(installationResources(packageRoot).command(group))).href));
    assert.ok(!loaded.some(url => url === pathToFileURL(realpathSync(installationResources(packageRoot).fallback)).href));
    assert.ok(!loaded.some(url => /\/entry-full\.js$/u.test(url)), JSON.stringify({ group, loaded }));
    for (const url of loaded.filter(url => /\/cli-command-/u.test(url))) assert.ok(url.endsWith(`/cli-command-${group}.js`), url);
    for (const url of loaded) assert.doesNotMatch(url, /\/(?:effect|@effect\/platform-node)\/dist\/index\.js$/u, 'ordinary startup loads only the required public submodules');
  }
});

// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
// @issue docs/issues/test-architecture-gaps.md
test('installed skill startup loads its packaged guide without repository command services', () => {
  const path = join(scratch, 'skill-loaded.json');
  const result = spawnSync(runtime, ['--import', resolve('test/support/cli-load-probe.ts'), applicationEntry, '--skill'], { cwd: scratch, env: { ...environment, CONCORD_TEST_LOADED_MODULES: path }, encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trimEnd(), readFileSync(join(applicationRoot(packageRoot), 'skills/concord/SKILL.md'), 'utf8').trimEnd());
  assert.equal(result.stderr, '');
  const loaded = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.String)))(readFileSync(path, 'utf8'));
  for (const url of loaded) {
    assert.doesNotMatch(url, /\/entry\/cli\/(?:main|cli-command-[^/]+)\.js$/u);
    assert.doesNotMatch(url, /\/dist\/(?:domain|base\/(?:workspace|publication|cache|server-lock))\//u);
  }
});

// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
test('installed routing preserves flags, unknown inputs, delimiters, completion and skills', () => Effect.runPromise(Effect.gen(function* () {
  const calls = [
    ['--json', 'unknown'], ['memory', 'unknown', '--json'], ['template', 'list', '--unknown', '--json'],
    ['--json', '--root', '/concord-missing-root', 'memory', 'search', 'cache'], ['--root=/concord-missing-root', 'memory', 'search', 'cache', '--json'],
    ['template', 'list', '--json'], ['--json=true', 'template', 'list'], ['template', '--', '--help'],
    ['memory', 'search', '--', '--json'], ['--root', '--help'], ['--unknown', 'template', 'list'],
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
  try { replace(path, Buffer.concat([before, Buffer.from('\n// changed installed module\n')])); assert.deepEqual(yield* invoke(args), expected); }
  finally { replace(path, before); }
})));

// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
test('help preserves terminal rendering and rejects mismatched generated data', () => {
  const manifest = installationResources(packageRoot).help;
  const original = readFileSync(manifest, 'utf8');
  const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const run = (args: readonly string[], env: NodeJS.ProcessEnv, tty: boolean) => {
    const invocation = [command, ...prefix, ...args];
    const result = spawnSync(tty ? 'script' : command,
      tty ? process.platform === 'darwin' ? ['-q', '/dev/null', ...invocation] : ['-q', '-e', '-c', invocation.map(shellQuote).join(' '), '/dev/null'] : [...prefix, ...args],
      { env, encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.error, undefined);
    return { stdout: result.stdout, stderr: result.stderr, status: result.status };
  };
  for (const [term, tty, color] of [['dumb', false, undefined], ['xterm-256color', false, undefined], ['xterm-256color', true, undefined], ['dumb', false, '1']] as const) {
    const env = { ...environment, TERM: term, FORCE_COLOR: color, NODE_NO_WARNINGS: '1' };
    for (const args of [['--help'], ['memory', 'search', '--help'], ['--version']]) {
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
    replace(fallback, Buffer.concat([fallbackBytes, Buffer.from('\n// changed complete fallback bytes\n')]));
    assert.deepEqual(run(['--help'], environment, false), expected, 'complete fallback identity');
  } finally { replace(fallback, fallbackBytes); }
  const start = original.indexOf('export default ') + 'export default '.length;
  const payload = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))(original.slice(start).trim().replace(/;$/u, ''));
  const receipts = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Struct({ stdout: Schema.String, stderr: Schema.String, status: Schema.Int })))(payload.receipts);
  const corrupted = `export default ${JSON.stringify({ ...payload, receipts: { ...receipts, '["--help"]': { ...receipts['["--help"]']!, stdout: 'CORRUPTED_HELP\n' } } })};\n`;
  for (const key of ['packageDigest', 'dataDigest', 'receipt']) {
    try {
      replace(manifest, key === 'receipt' ? corrupted : original.replace(new RegExp(`"${key}":"[a-f0-9]+"`, 'u'), `"${key}":"${'0'.repeat(64)}"`));
      assert.deepEqual(run(['--help'], environment, false), expected, key);
    } finally { replace(manifest, original); }
  }
});

for (const check of checks) {
  const started = performance.now();
  try { await check.run(); }
  catch (cause) { throw new Error(`Installed startup check failed: ${check.name}`, { cause }); }
  console.error(`# Installed startup: ${check.name}: ${((performance.now() - started) / 1000).toFixed(3)}s`);
}
}
