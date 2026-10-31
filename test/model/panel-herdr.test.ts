import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, copyFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { Effect } from 'effect';
import { bindHerdrManifest, openHerdrPanel, panelOpenRequest } from '../../src/entry/panel/index.js';
import { tmpdir } from '../support/temporary.js';

// @use-case docs/feature/herdr-panel/use-case/open-side-panel.md#验收
test('installed plugin manifest binds only absolute commands, with one action and one managed pane', () => Effect.runSync(Effect.sync(() => {
  const source = readFileSync(new URL('../../herdr/herdr-plugin.toml', import.meta.url), 'utf8');
  const manifest = bindHerdrManifest(source, '/opt/Concord space/dist/entry/cli/entry.js', '/opt/node', '/opt/Concord space/dist/entry/panel/herdr-action.js');
  assert.equal(manifest.match(/\[\[actions\]\]/gu)?.length, 1); assert.equal(manifest.match(/\[\[panes\]\]/gu)?.length, 1);
  assert.doesNotMatch(manifest, /__CONCORD|__NODE/u);
  const commands = [...manifest.matchAll(/^command = (.+)$/gmu)].map(match => JSON.parse(match[1]!));
  assert.deepEqual(commands, [['/opt/node', '/opt/Concord space/dist/entry/panel/herdr-action.js'], ['/opt/Concord space/dist/entry/cli/entry.js', 'panel']]);
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { files: string[]; scripts: Record<string, string> };
  assert.ok(pkg.files.includes('herdr')); assert.ok(pkg.files.includes('src/entry/panel/install-herdr.ts')); assert.ok(pkg.scripts.postinstall?.includes('install-herdr.ts'));
  assert.throws(() => bindHerdrManifest(source, 'concord', '/node', '/action'));
})));

// @use-case docs/feature/herdr-panel/use-case/open-side-panel.md#验收
test('Herdr action uses invocation cwd and pane id without substituting workspace or process cwd', () => Effect.runSync(Effect.sync(() => {
  const context = { focused_pane_cwd: '/repo/current pane', focused_pane_id: 'w1:p4', workspace_cwd: '/wrong' };
  const request = Effect.runSync(panelOpenRequest(context));
  assert.equal(request.method, 'plugin.pane.open'); assert.equal(request.params.direction, 'right');
  assert.equal(request.params.cwd, context.focused_pane_cwd); assert.equal(request.params.target_pane_id, 'w1:p4');
  assert.equal(Effect.runSync(panelOpenRequest({ workspace_cwd: '/wrong', focused_pane_id: 'p4' }).pipe(Effect.flip))._tag, 'PanelWorktreeUnknown');
  assert.equal(Effect.runSync(panelOpenRequest({ focused_pane_cwd: 'relative', focused_pane_id: 'p4' }).pipe(Effect.flip))._tag, 'PanelWorktreeUnknown');
})));

// @use-case docs/feature/herdr-panel/use-case/open-side-panel.md#验收
test('action makes one bounded newline request and reports host errors from a real local socket', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = mkdtempSync(join(tmpdir(), 'panel-herdr-')), path = join(root, 'host.sock');
  let response = { result: { pane_id: 'opened' } } as { result?: unknown; error?: { code: string; message: string } };
  const requests: unknown[] = [];
  const server = createServer(socket => {
    let text = '';
    socket.on('data', chunk => { text += String(chunk); if (text.includes('\n')) { requests.push(JSON.parse(text)); socket.end(JSON.stringify({ id: 'concord-panel', ...response }) + '\n'); } });
  });
  try {
    server.listen(path); await once(server, 'listening');
    const context = { focused_pane_cwd: '/repo', focused_pane_id: 'p1' };
    assert.deepEqual(await Effect.runPromise(openHerdrPanel(context, path)), { pane_id: 'opened' });
    assert.equal(requests.length, 1);
    response = { error: { code: 'unknown_plugin', message: 'not linked' } };
    const error = await Effect.runPromise(openHerdrPanel(context, path).pipe(Effect.flip));
    assert.equal(error._tag, 'PanelHerdrUnavailable'); assert.match(error.message, /not linked/u);
  } finally { server.close(); await once(server, 'close'); rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/herdr-panel/use-case/open-side-panel.md#验收
test('installation lifecycle binds a packaged manifest and leaves a source checkout unchanged', () => Effect.runSync(Effect.sync(() => {
  const root = mkdtempSync(join(tmpdir(), 'panel-install-'));
  try {
    mkdirSync(join(root, 'src/entry/panel'), { recursive: true }); mkdirSync(join(root, 'herdr'));
    for (const name of ['herdr.ts', 'install-herdr.ts']) copyFileSync(new URL(`../../src/entry/panel/${name}`, import.meta.url), join(root, 'src/entry/panel', name));
    const template = readFileSync(new URL('../../herdr/herdr-plugin.toml', import.meta.url), 'utf8');
    writeFileSync(join(root, 'herdr/herdr-plugin.toml'), template);
    // Load installed runtime dependencies from the real checkout; the fixture's files stay private.
    symlinkSync(new URL('../../node_modules', import.meta.url), join(root, 'node_modules'), 'dir');
    const run = () => spawnSync(process.execPath, ['--import', 'tsx', join(root, 'src/entry/panel/install-herdr.ts')], { cwd: root, encoding: 'utf8', timeout: 10000 });
    const installed = run(); assert.equal(installed.status, 0, installed.stderr);
    assert.match(readFileSync(join(root, 'herdr/herdr-plugin.toml'), 'utf8'), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')));
    mkdirSync(join(root, 'src/entry/cli')); writeFileSync(join(root, 'src/entry/cli/entry.ts'), '');
    writeFileSync(join(root, 'herdr/herdr-plugin.toml'), template);
    const source = run(); assert.equal(source.status, 0, source.stderr);
    assert.equal(readFileSync(join(root, 'herdr/herdr-plugin.toml'), 'utf8'), template);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));
