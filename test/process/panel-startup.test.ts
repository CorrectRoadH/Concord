import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { installationResources } from '../../src/base/installation/index.js';
import { openTerminal } from '../../scripts/terminal-process.js';
import { installConcord, packConcord } from '../support/installed-package.js';
import { command, fixture, recordPath } from '../support/workspace-server-fixture.js';
import { pollUntil, writeProjectConfig } from '../support/support.js';
import { tmpdir } from '../support/temporary.js';

// @use-case docs/feature/herdr-panel/use-case/open-side-panel.md
// @issue docs/issues/workspace-server-unimplemented.md
test('generated panel startup and the complete CLI preserve root errors, path safety and the readable generation', { timeout: 45_000 }, async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'concord-panel-startup-')), root = fixture();
  const install = join(scratch, 'install'); mkdirSync(install); writeFileSync(join(install, 'package.json'), '{"private":true}');
  installConcord(install, packConcord(scratch), [], { private: true });
  const resources = installationResources(join(install, 'node_modules/concord-sdlc'));
  const manifest = resources.help, saved = `${manifest}.saved`;
  const generated = JSON.parse(readFileSync(manifest, 'utf8').split('export default ')[1]!.trim().replace(/;$/u, '')) as { panelStarts: string[][] };
  assert.deepEqual(generated.panelStarts, [['panel'], ['--root', '<root>', 'panel']]);
  const plain = join(scratch, 'plain'); mkdirSync(plain);
  const alias = join(scratch, 'alias'); symlinkSync(root, alias);
  const environment = { ...process.env, NO_COLOR: '1', TERM: 'dumb' };
  const invoke = (args: readonly string[], cwd: string) => {
    const result = spawnSync(process.execPath, [resources.bin, ...args], { cwd, env: environment, encoding: 'utf8', timeout: 15_000 });
    assert.equal(result.error, undefined);
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  };
  try {
    for (const [args, cwd] of [
      [['--root'], plain], [['--root', '--json', 'panel'], plain],
      [['--root', join(scratch, 'missing'), 'panel'], plain],
      [['--root', plain, 'panel'], plain], [['panel'], plain],
      [['--root', alias, 'panel'], plain],
    ] as const) {
      const expected = invoke(args, cwd); assert.equal(expected.status, 1, JSON.stringify({ args, expected }));
      renameSync(manifest, saved);
      try { assert.deepEqual(invoke(args, cwd), expected, JSON.stringify(args)); }
      finally { renameSync(saved, manifest); }
    }
    writeProjectConfig(root, {});
    const nested = join(root, 'nested'); mkdirSync(nested);
    const observer = join(scratch, 'observe-parser.mjs'), observed = join(scratch, 'parser-loaded');
    writeFileSync(observer, `import { registerHooks } from 'node:module'; import { writeFileSync } from 'node:fs'; registerHooks({ load(url, context, next) { if(url.endsWith('/effect/dist/unstable/cli/Command.js')) writeFileSync(${JSON.stringify(observed)}, 'loaded'); return next(url, context); } });`);
    const firstFrame = async (args: readonly string[], parsed: boolean) => {
      const started = await command(root, ['server', 'start'], resources.bin);
      assert.equal(started.status, 0, started.stderr);
      await pollUntil(async () => {
        const result = await command(root, ['workspace', 'projection'], resources.bin);
        if (result.status !== 0) return undefined;
        const value = JSON.parse(result.stdout) as { snapshot?: { documents: { path: string }[] } };
        return value.snapshot?.documents.some(document => document.path === 'docs/feature/reader/README.md') ? true : undefined;
      }, { description: 'this installation has accepted the Reader generation before comparing startup paths', timeoutMs: 10_000 });
      return Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      rmSync(observed, { force: true });
      const terminal = yield* openTerminal([process.execPath, '--import', observer, resources.bin, ...args], nested, environment);
      yield* terminal.waitFor('数字+Enter 链接 · c数字+Enter 概念 · o 在 Web 中打开');
      const text = terminal.text(), end = text.indexOf('数字+Enter 链接 · c数字+Enter 概念 · o 在 Web 中打开');
      assert.match(text, /Reader/u); assert.match(text, /测试声明：0 项/u);
      assert.equal(existsSync(observed), parsed, 'only the complete fallback loads the general command parser');
      yield* terminal.send('q');
      return text.slice(0, end).split('\n').map(line => line.trimEnd()).join('\n');
      })));
    };
    for (const args of [['panel'], ['--root', root, 'panel']]) {
      const expected = await firstFrame(args, false);
      renameSync(manifest, saved);
      try { assert.equal(await firstFrame(args, true), expected); }
      finally { renameSync(saved, manifest); }
    }
  } finally {
    try {
      await command(root, ['server', 'stop'], resources.bin);
      await pollUntil(async () => { try { readFileSync(recordPath(root)); return undefined; } catch { return true; } }, { description: 'private panel startup service releases its record', timeoutMs: 8000 });
    } finally { rmSync(root, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); }
  }
});
