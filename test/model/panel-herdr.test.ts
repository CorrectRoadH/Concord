import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Effect } from 'effect';
import { bindHerdrManifest, panelOpenCommand, pluginDestinationAllowed } from '../../src/entry/panel/index.js';
import { tmpdir } from '../support/temporary.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const manifestPath = join(root, 'herdr/herdr-plugin.toml');

// @use-case docs/feature/herdr-panel/use-case/open-side-panel.md#验收
test('Herdr build binds absolute Node and Concord commands without npm hooks or packaged source', () => Effect.runSync(Effect.sync(() => {
  const source = readFileSync(manifestPath, 'utf8');
  const manifest = bindHerdrManifest(source, '/opt/Concord space/dist/entry/cli/entry.js', '/opt/node', '/opt/Concord space/dist/entry/panel/herdr-action.js');
  assert.equal(manifest.match(/\[\[actions\]\]/gu)?.length, 1); assert.equal(manifest.match(/\[\[panes\]\]/gu)?.length, 1);
  assert.match(source, /\[\[build\]\]\nplatforms = \["linux", "macos"\]/u);
  assert.match(source, /CONCORD_INSTALLATION[^\n]+\/dist\/entry\/panel\/install-herdr\.js/u);
  assert.doesNotMatch(source, /tsx|src\/entry|postinstall/u);
  assert.doesNotMatch(manifest, /__CONCORD|__NODE/u);
  const action = /^command = (.+)$/mu.exec(manifest.split('[[actions]]')[1]!.split('[[panes]]')[0]!)!;
  const pane = /^command = (.+)$/mu.exec(manifest.split('[[panes]]')[1]!)!;
  assert.deepEqual(JSON.parse(action[1]!), ['/opt/node', '/opt/Concord space/dist/entry/panel/herdr-action.js']);
  assert.deepEqual(JSON.parse(pane[1]!), ['/opt/node', '/opt/Concord space/dist/entry/cli/entry.js', 'panel']);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { files: string[]; scripts: Record<string, string> };
  assert.ok(pkg.files.includes('herdr')); assert.ok(!pkg.files.some(path => path.startsWith('src/')));
  assert.equal(pkg.scripts.postinstall, undefined);
  assert.throws(() => bindHerdrManifest(source, 'concord', '/node', '/action'));
})));

// @use-case docs/feature/herdr-panel/use-case/open-side-panel.md#验收
test('Herdr CLI action forwards invocation cwd and pane as data and never substitutes a fallback cwd', () => Effect.runSync(Effect.sync(() => {
  const context = { focused_pane_cwd: '/repo/current pane', focused_pane_id: 'w1:p4', workspace_cwd: '/wrong' };
  const command = Effect.runSync(panelOpenCommand(context, '/opt/Herdr CLI'));
  assert.equal(command.binary, '/opt/Herdr CLI'); assert.equal(command.cwd, context.focused_pane_cwd);
  assert.deepEqual(command.args, ['plugin', 'pane', 'open', '--plugin', 'concord', '--entrypoint', 'spec', '--placement', 'split', '--direction', 'right', '--focus', '--cwd', '/repo/current pane', '--target-pane-id', 'w1:p4']);
  assert.equal(Effect.runSync(panelOpenCommand({ workspace_cwd: '/wrong', focused_pane_id: 'p4' }).pipe(Effect.flip))._tag, 'PanelWorktreeUnknown');
  assert.equal(Effect.runSync(panelOpenCommand({ focused_pane_cwd: 'relative', focused_pane_id: 'p4' }).pipe(Effect.flip))._tag, 'PanelWorktreeUnknown');
  assert.equal(Effect.runSync(panelOpenCommand(context)).binary, 'herdr');
})));

// @use-case docs/feature/herdr-panel/use-case/open-side-panel.md#验收
test('action entry executes the injected CLI and returns a named failure before spawning when cwd is absent', () => Effect.runSync(Effect.sync(() => {
  const scratch = mkdtempSync(join(tmpdir(), 'panel-cli-'));
  try {
    const fakeCli = join(scratch, 'host cli'), capture = join(scratch, 'argv');
    // External CLI boundary only: all parsing and process execution are real product code.
    writeFileSync(fakeCli, '#!/bin/sh\nprintf "%s\\n" "$@" > "$PANEL_TEST_CAPTURE"\nexit "$PANEL_TEST_STATUS"\n', { mode: 0o755 });
    const run = (context: unknown, status = '0') => spawnSync(process.execPath, ['--import', 'tsx', join(root, 'src/entry/panel/herdr-action.ts')], {
      cwd: root, encoding: 'utf8', timeout: 10000,
      env: { ...process.env, HERDR_BIN_PATH: fakeCli, HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify(context), PANEL_TEST_CAPTURE: capture, PANEL_TEST_STATUS: status },
    });
    const context = { focused_pane_cwd: scratch, focused_pane_id: 'p1' };
    const opened = run(context); assert.equal(opened.status, 0, opened.stderr);
    assert.deepEqual(readFileSync(capture, 'utf8').trimEnd().split('\n'), Effect.runSync(panelOpenCommand(context)).args);
    const rejected = run(context, '23'); assert.notEqual(rejected.status, 0); assert.match(rejected.stdout + rejected.stderr, /PanelHerdrUnavailable|status 23/u);
    rmSync(capture);
    const missing = run({ focused_pane_id: 'p1' }); assert.notEqual(missing.status, 0); assert.match(missing.stdout + missing.stderr, /PanelWorktreeUnknown/u);
    assert.equal(existsSync(capture), false);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
})));

// @use-case docs/feature/herdr-panel/use-case/open-side-panel.md#验收
test('Herdr binder writes only its private plugin destination and refuses the Concord package or checkout', () => Effect.runSync(Effect.sync(() => {
  const plugin = mkdtempSync(join(tmpdir(), 'panel-plugin-'));
  const template = readFileSync(manifestPath, 'utf8');
  try {
    writeFileSync(join(plugin, 'herdr-plugin.toml'), template);
    const run = (destination: string) => spawnSync(process.execPath, ['--import', 'tsx', join(root, 'src/entry/panel/install-herdr.ts'), '--plugin-dir', destination], { cwd: root, encoding: 'utf8', timeout: 10000 });
    const installed = run(plugin); assert.equal(installed.status, 0, installed.stderr);
    const bound = readFileSync(join(plugin, 'herdr-plugin.toml'), 'utf8');
    assert.doesNotMatch(bound, /__CONCORD|__NODE/u);
    assert.ok(bound.includes(JSON.stringify(join(root, 'dist/entry/cli/entry.js'))));
    assert.ok(bound.includes(JSON.stringify(process.execPath)));
    const rejected = run(join(root, 'herdr')); assert.notEqual(rejected.status, 0); assert.match(rejected.stdout + rejected.stderr, /PanelPluginDestinationInvalid/u);
    assert.equal(readFileSync(manifestPath, 'utf8'), template);
    assert.equal(pluginDestinationAllowed(root, resolve(root, '..hidden')), false);
    assert.equal(pluginDestinationAllowed(root, plugin), true);
  } finally { rmSync(plugin, { recursive: true, force: true }); }
})));
