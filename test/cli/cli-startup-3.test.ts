import { assert, execFile, spawnSync, appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync, tmpdir, join, resolve, pathToFileURL, test, Effect, Schema, installationResources, packageBin, environment, scratch, packageRoot, entry, invoke, helpCalls } from '../support/startup-fixture.js';

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
