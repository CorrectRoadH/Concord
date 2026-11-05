import { stopWorkspaceServer } from '../support/stop-workspace-server.js';
import { nativeArtifactRoot, nativeSourceFiles } from "../../src/base/installation/index.js";
import { basename, dirname } from "node:path";
// @concord-file
// @concord-implements docs/engineering/build/architecture.md#从源码运行
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from '../support/temporary.js';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Effect, Schema } from 'effect';

const checkout = fileURLToPath(new URL('../../', import.meta.url));
const Output = Schema.Struct({ ok: Schema.optional(Schema.Boolean), error: Schema.optional(Schema.String), message: Schema.optional(Schema.String),
  operation: Schema.optional(Schema.String), cache: Schema.optional(Schema.Struct({ status: Schema.String })),
  projection: Schema.optional(Schema.Struct({ current: Schema.Boolean })) });
const decodeOutput = Schema.decodeUnknownSync(Schema.fromJsonString(Output), { onExcessProperty: 'ignore' });

function installation() {
  const scratch = mkdtempSync(join(tmpdir(), 'concord-source-run-'));
  const tool = join(scratch, 'tool'), consumer = join(scratch, 'consumer');
  mkdirSync(tool); mkdirSync(consumer);
  // Copy a fixed source snapshot so concurrent edits cannot change worker identity.
  for (const name of ['src', 'web', 'scripts', 'templates', 'skills', 'package.json', 'vite.config.ts', 'vite.preview.config.ts']) cpSync(join(checkout, name), join(tool, name), { recursive: true });
  for (const file of [...nativeSourceFiles.filter(file => file.startsWith('native/')), 'native/hawdb/Cargo.lock']) { mkdirSync(dirname(join(tool, file)), { recursive: true }); cpSync(join(checkout, file), join(tool, file)); }
  const cache = join(scratch, 'cache');
  const native = join(cache, 'concord/native', basename(nativeArtifactRoot));
  cpSync(nativeArtifactRoot, native, { recursive: true });
  symlinkSync(join(checkout, 'node_modules'), join(tool, 'node_modules'), 'dir');
  execFileSync('git', ['init', '-q', consumer]);
  const call = (...args: string[]) => spawnSync(process.execPath,
    ['--import', import.meta.resolve('tsx'), join(tool, 'src/entry/cli/entry.ts'), '--root', consumer, ...args],
    { env: { ...process.env, XDG_CACHE_HOME: cache }, cwd: consumer, encoding: 'utf8', timeout: 30_000 });
  const success = (...args: string[]) => {
    const result = call('--json', ...args);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return decodeOutput(result.stdout);
  };
  return { scratch, tool, consumer, call, success, cache, native };
}

/** Drain only this fixture's detached supervisor before removing its source tree. */
const drainRefresh = Effect.fn('sourceRun.drainRefresh')(function*(tool: string, consumer: string) {
  const deadline = Date.now() + 130_000;
  while (true) {
    const active = yield* Effect.sync(() => execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n')
      .filter(line => line.includes(`${tool}/src/entry/server/query-refresh-worker.ts ${consumer} `)));
    if (active.length === 0) return;
    assert.ok(Date.now() < deadline, `Source refresh did not exit: ${active.join('\n')}`);
    yield* Effect.sleep('100 millis');
  }
});
// @feature docs/feature/local-sdlc/README.md
test('source CLI and refresh workers run without any built JavaScript in an isolated Git consumer', () => Effect.runPromise(Effect.gen(function*() {
  const fixture = yield* Effect.sync(installation);
  try {
    yield* Effect.sync(() => {
      assert.equal(existsSync(join(fixture.tool, 'dist')), false);
      const version = fixture.call('--version');
      const manifest = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ version: Schema.String })), { onExcessProperty: 'ignore' })(readFileSync(join(fixture.tool, 'package.json'), 'utf8'));
      assert.equal(version.status, 0, version.stderr);
      assert.equal(version.stdout.trim(), `concord v${manifest.version}`);
      fixture.success('init', '--docs-only', '--yes');
      fixture.success('new', 'feature', 'sample', '--title', 'Sample');
      assert.equal(fixture.success('--dry-run', 'check').ok, true);
      assert.equal(fixture.success('docs', 'check').ok, true);
      stopWorkspaceServer(fixture.consumer, join(fixture.tool, 'src/entry/cli/entry.ts'), { ...process.env, XDG_CACHE_HOME: fixture.cache }, ['--import', import.meta.resolve('tsx')]);
      const refresh = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), join(fixture.tool, 'src/entry/server/query-refresh-worker.ts'),
        fixture.consumer, JSON.stringify(['trace', 'show', 'docs/feature/sample/README.md']), String(Date.now())],
      { env: { ...process.env, XDG_CACHE_HOME: fixture.cache }, cwd: fixture.consumer, encoding: 'utf8', timeout: 30_000 });
      assert.equal(refresh.status, 0, refresh.stdout + refresh.stderr);
      const historical = fixture.success('trace', 'show', 'docs/feature/sample/README.md');
      assert.equal(historical.projection?.current, false);
      assert.equal(fixture.success('--fresh', 'trace', 'show', 'docs/feature/sample/README.md').operation, 'trace-show');
    });
  } finally {
    stopWorkspaceServer(fixture.consumer, join(fixture.tool, 'src/entry/cli/entry.ts'), { ...process.env, XDG_CACHE_HOME: fixture.cache }, ['--import', import.meta.resolve('tsx')]);
    yield* drainRefresh(fixture.tool, fixture.consumer);
    yield* Effect.sync(() => rmSync(fixture.scratch, { recursive: true, force: true }));
  }
})));

// @feature docs/feature/local-sdlc/README.md
test('source commands explain missing native artifacts before starting work', () => Effect.runPromise(Effect.sync(() => {
  const fixture = installation();
  try {
    fixture.success('init', '--docs-only', '--yes');
    renameSync(fixture.native, join(fixture.tool, 'native-hidden'));
    const missing = fixture.call('--json', 'trace', 'gaps');
    assert.equal(missing.status, 1, missing.stdout + missing.stderr);
    assert.match(missing.stderr, /^\{/u, missing.stdout + missing.stderr);
    const error = decodeOutput(missing.stderr);
    assert.equal(error.error, 'HawdbUnavailable');
    assert.match(error.message!, /pnpm exec vp run build:native/u);
  } finally { rmSync(fixture.scratch, { recursive: true, force: true }); }
})));
