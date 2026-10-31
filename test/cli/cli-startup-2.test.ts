import { assert, execFile, spawnSync, appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync, tmpdir, join, resolve, pathToFileURL, test, Effect, Schema, installationResources, packageBin, environment, scratch, packageRoot, entry, invoke, helpCalls } from '../support/startup-fixture.js';

// @use-case docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md
test('installed ordinary commands load only their selected command group', () => {
  for (const [group, args] of [['memory', ['--json', '--root', scratch, 'memory', 'search', 'cache']], ['template', ['template', 'list', '--json']]] as const) {
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
