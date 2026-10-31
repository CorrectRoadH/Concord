import { assert, execFile, spawnSync, appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync, tmpdir, join, resolve, pathToFileURL, test, Effect, Schema, installationResources, packageBin, environment, scratch, packageRoot, entry, invoke, helpCalls } from '../support/startup-fixture.js';

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
