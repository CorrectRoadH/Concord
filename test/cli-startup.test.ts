import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';

// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
test('built help avoids unused Effect services and Markdown/compiler initialization', () => Effect.runPromise(Effect.sync(() => {
  const scratch = mkdtempSync(join(tmpdir(), 'concord-cli-startup-'));
  try {
    const loadedPath = join(scratch, 'loaded.json');
    const stdoutPath = join(scratch, 'stdout');
    const stderrPath = join(scratch, 'stderr');
    const stdout = openSync(stdoutPath, 'w');
    const stderr = openSync(stderrPath, 'w');
    try {
      const result = spawnSync(process.execPath, ['--import', 'tsx', '--import', resolve('test/cli-load-probe.ts'), resolve('dist/entry.js'), '--help'], {
        cwd: resolve('.'), stdio: ['ignore', stdout, stderr], env: { ...process.env, CONCORD_TEST_LOADED_MODULES: loadedPath },
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, readFileSync(stderrPath, 'utf8'));
      assert.match(readFileSync(stdoutPath, 'utf8'), /concord --skill/);
    } finally { closeSync(stdout); closeSync(stderr); }
    const loaded = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.String)))(readFileSync(loadedPath, 'utf8'));
    assert.ok(loaded.some(url => url.endsWith('/dist/cli.js')), 'probe must observe the actual CLI');
    for (const url of loaded) {
      assert.doesNotMatch(url, /\/(?:effect|@effect\/platform-node)\/dist\/index\.js$/u);
      assert.doesNotMatch(url, /\/effect\/dist\/unstable\/(?:cluster|sql)\//u);
      assert.doesNotMatch(url, /\/mdast-util-from-markdown\//u);
      assert.doesNotMatch(url, /\/typescript\/lib\/typescript\.js$/u);
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
})));
