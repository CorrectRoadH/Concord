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
test('generated panel startup and the complete CLI preserve root errors and path safety', { timeout: 45_000 }, async () => {
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
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); }
});
