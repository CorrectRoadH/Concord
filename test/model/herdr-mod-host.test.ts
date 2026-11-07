/// <reference path="../../src/entry/herdr-mod/host.d.ts" />
import assert from 'node:assert/strict';
import { plugin } from 'bun';
import test from 'node:test';
import { digest } from '../../src/model/index.ts';
import type { AsyncContext, Context, Task } from 'gpui-kit';

// Only the GPUI/Herdr host boundary is simulated. The source View and Effect
// session run unchanged, including scheduling and public command decoding.
class Element {
  key = '';
  nodes: (Element | string)[] = [];
  click: ((event: unknown, cx: Context) => void) | undefined;
  link: ((url: string, cx: Context) => void) | undefined;
  state: State | undefined;
  private consumed = false;
  id(key: string) { this.key = key; return this; }
  child(child: Element | string) {
    if (child instanceof Element) { assert.equal(child.consumed, false, 'native element has one parent'); child.consumed = true; }
    this.nodes.push(child); return this;
  }
  children(children: readonly (Element | string)[]) { children.forEach(child => this.child(child)); return this; }
  size_full() { return this; } flex_1() { return this; } min_w(_v: number) { return this; } min_h(_v: number) { return this; }
  max_w(_v: number) { return this; } items_center() { return this; } items_start() { return this; } justify_center() { return this; }
  w(_v: number) { return this; } h(_v: number) { return this; } gap(_v: number) { return this; }
  p(_v: number) { return this; } px(_v: number) { return this; } py(_v: number) { return this; }
  bg(_v: string) { return this; } text_color(_v: string) { return this; } text_size(_v: number) { return this; }
  rounded(_v: number) { return this; } overflow_y_scroll() { return this; }
  items_stretch() { return this; } overflow_hidden() { return this; }
  on_click(body: (event: unknown, cx: Context) => void) { this.click = body; return this; }
  on_link_click(body: (url: string, cx: Context) => void) { this.link = body; return this; }
  find(key: string): Element | undefined {
    if (this.key === key) return this;
    for (const child of this.nodes) { const found = child instanceof Element ? child.find(key) : undefined; if (found) return found; }
    return undefined;
  }
  text(): string { return this.nodes.map(child => typeof child === 'string' ? child : child.text()).join('\n'); }
}
class State {
  released = false;
  private source: string;
  constructor(source: string) { this.source = source; }
  value() { assert.equal(this.released, false); return this.source; }
  set_value(value: string) { assert.equal(this.released, false); this.source = value; }
  release() { assert.equal(this.released, false, 'retained state released once'); this.released = true; return true; }
}
function pending<A>() {
  let resolve!: (value: A) => void, reject!: (cause: Error) => void;
  const promise = new Promise<A>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
interface HostTask extends Task { done: boolean; cancelled: boolean }
interface Timer { task: HostTask; ms: number; repeat: boolean; body: (cx: AsyncContext) => void }
const page = 'docs/feature/cart/README.md';
class Boundary {
  cwd: string | null = '/repo';
  paneList: { pane: string; terminal: string | null; cwd: string | null; focused: boolean; tab: string; mod?: string }[] = [{ pane: 'p1', terminal: 't1', cwd: '/repo', focused: true, tab: 't1' }];
  spaceList = [{ id: 's1', folder: '/unused', active: true, machine: null as string | null, tabs: [{ id: 't1', active: true }] }];
  focusedTab = 't1';
  roots = new Map([['/repo', '/repo'], ['/repo/src', '/repo'], ['/other', '/other']]);
  requests: { command: string; args: string[]; options?: { cwd?: string; on?: string | null } }[] = [];
  reachable = true;
  commandError: { code: number; stdout: string; stderr: string } | undefined;
  commands: { name: string; args?: Record<string, unknown> }[] = [];
  closedOverlays: string[] = [];
  installedVersion: string | undefined = 'dev';
  props: Record<string, unknown> = {};
  files = new Map([[`/repo/${page}`, '# Cart\n'], ['/repo/docs/taste.md', '# Taste\n']]);
  calls: string[][] = [];
  watches: { root: string; result: ReturnType<typeof pending<{ code: number; stdout: string; stderr: string }>> }[] = [];
  tasks: HostTask[] = [];
  timers: Timer[] = [];
  states: State[] = [];
  errors: unknown[] = [];
  picker = pending<string | null>();
  closed = false;
  output = new Element();
  view: { render(cx: Context): unknown; close(cx: AsyncContext): void } | undefined;
  task(): HostTask {
    const task = { done: false, cancelled: false, cancel() { this.cancelled = true; }, is_done() { return this.done || this.cancelled; } };
    this.tasks.push(task); return task;
  }
  context(owner?: HostTask): AsyncContext {
    return {
      notify: () => { assert.equal(this.closed || owner?.cancelled === true, false, 'fresh live context'); this.draw(); },
      spawn: body => {
        const task = this.task();
        void Promise.resolve().then(() => task.cancelled ? undefined : body(this.context(task))).catch(cause => this.errors.push(cause)).finally(() => { task.done = true; });
        return task;
      },
      timer: {
        after: (ms, body) => this.timer(ms, body, false),
        every: (ms, body) => this.timer(ms, body, true),
      },
    };
  }
  timer(ms: number, body: (cx: AsyncContext) => void, repeat: boolean) {
    const task = this.task(); this.timers.push({ task, ms, repeat, body }); return task;
  }
  fire(ms: number) {
    for (const timer of [...this.timers]) {
      if (timer.ms !== ms || timer.task.is_done()) continue;
      if (!timer.repeat) timer.task.done = true;
      timer.body(this.context(timer.task));
    }
  }
  draw() { if (this.view) this.output = this.view.render(this.context()) as Element; }
  click(key: string) { const element = this.output.find(key); assert.ok(element?.click, key); element.click(undefined, this.context()); }
  state(value = '') { const state = new State(value); this.states.push(state); return state; }
  async exec(command: string, args: string[], options?: { cwd?: string; on?: string | null }) {
    this.requests.push({ command, args, options });
    if (options?.on && !this.reachable) throw new Error('transport unavailable: private diagnostic');
    if (command === 'git' || command === 'sh') {
      const root = this.roots.get(options?.cwd ?? '');
      return { code: root ? 0 : 128, stdout: root ? command === 'sh' ? `/home/remote\n${root}\n` : `${root}\n` : '', stderr: root ? '' : 'fatal: not a git repository' };
    }
    assert.equal(command, 'concord');
    if (args[0] === '--version') {
      if (this.installedVersion === undefined) throw new Error('cannot start concord');
      return { code: 0, stdout: `concord v${this.installedVersion}\n`, stderr: '' };
    }
    if (this.commandError) return this.commandError;
    const operation = args.includes('--root') ? args.slice(args.indexOf('--root') + 2) : args.slice(2); this.calls.push(operation);
    if (operation[0] === 'workspace' && operation[1] === 'wait') {
      const result = pending<{ code: number; stdout: string; stderr: string }>();
      this.watches.push({ root: options?.cwd ?? '', result });
      return result.promise;
    }
    if (operation[0] === 'action') {
      const input = JSON.parse(operation.filter(value => value.startsWith('--input-text=')).map(value => value.slice('--input-text='.length)).join('')) as { action: string; path: string; body: string; expectedDigest: string };
      const absolute = `${options?.cwd}/${input.path}`, source = this.files.get(absolute);
      const error = (name: string) => ({ code: 1, stdout: '', stderr: JSON.stringify({ error: name, message: name }) });
      if (input.action === 'file.get') return source === undefined ? error('FileNotFound') : { code: 0, stdout: JSON.stringify({ path: input.path, body: source, digest: digest(source) }), stderr: '' };
      assert.equal(input.action, 'document.set');
      if (source === undefined || digest(source) !== input.expectedDigest) return error('FileChangedSinceRead');
      this.files.set(absolute, input.body);
      return { code: 0, stdout: JSON.stringify({ changedPaths: [input.path] }), stderr: '' };
    }
    const data = operation[0] === 'doctor' ? { root: this.roots.get(options?.cwd ?? '') ?? options?.cwd, configuration: { sourceRoots: ['src'], testRoots: ['test'] } }
      : operation[0] === 'list' ? { documents: [{ path: page, kind: 'feature', title: 'Cart' }] }
      : operation[0] === 'concepts' ? { concepts: [], catalogs: [] }
      : operation[0] === 'show' ? { pages: [{ path: page, name: 'Cart', kind: 'readme' }] }
      : operation[0] === 'init' ? { createdPaths: ['docs/taste.md'], guide: 'docs-from-scratch' }
      : operation[0] === 'new' ? { changedPaths: [page] }
      : operation[0] === 'check' ? { ok: true, findings: [] }
      : {};
    if (operation[0] === 'init') this.files.set(`${options?.cwd}/docs/taste.md`, '# Taste');
    return { code: 0, stdout: JSON.stringify(data), stderr: '' };
  }
  async until(predicate: () => boolean) {
    for (let turn = 0; turn < 100; turn++) {
      if (this.errors.length) throw this.errors[0];
      if (predicate()) return;
      await new Promise<void>(resolve => setImmediate(resolve));
    }
    assert.fail(`Host state did not settle: ${this.output.text()}`);
  }
  close() { this.view!.close(this.context()); this.closed = true; }
}
let host: Boundary;
const external = {
  View: class {}, div: () => new Element(), h_flex: () => new Element(), v_flex: () => new Element(),
  TextView: { markdown: (id: string, source: string) => new Element().id(id).child(source) },
  InputState: { new: (options?: { value?: string }) => host.state(options?.value) },
  EditorState: { new: (options?: { value?: string }) => host.state(options?.value) },
  Input: { new: (state: State) => { const element = new Element(); element.state = state; return element; } },
  Editor: { new: (state: State) => { const element = new Element(); element.state = state; return element; } },
  exec: (command: string, args: string[], options?: { cwd?: string; on?: string | null }) => host.exec(command, args, options),
  focused: () => ({ cwd: host.cwd, pane: host.paneList.find(pane => pane.focused)?.pane ?? null, terminal: null, shown: null, agent: null, space: 's1', tab: host.focusedTab }),
  panes: () => host.paneList, spaces: () => host.spaceList,
  run: (name: string, args?: Record<string, unknown>) => { host.commands.push({ name, args }); return null; },
  closeOverlay: (id: string) => { host.closedOverlays.push(id); return null; },
  appHome: () => '/herdr',
  home: () => '/home/local',
  props: () => host.props,
  theme: () => ({}),
};
const global = globalThis as typeof globalThis & { __concordHostSync?: typeof external };

// @use-case docs/feature/herdr-mod/use-case/follow-changes.md
test('source mod obeys native host invalidation and retained-state boundaries', async t => {
  global.__concordHostSync = external;
  const names: Record<string, string[]> = {
    'gpui-kit': ['View', 'div'],
    'gpui-base': ['h_flex', 'v_flex', 'TextView', 'Editor', 'EditorState', 'Input', 'InputState'],
    herdr: ['exec', 'focused', 'panes', 'spaces', 'run', 'closeOverlay', 'home', 'props', 'theme'],
  };
  plugin({ name: 'concord-test-herdr-host', setup(build) {
    for (const [specifier, members] of Object.entries(names)) {
      build.module(specifier, () => ({ loader: 'object', exports: Object.fromEntries(members.map(name => [name, external[name as keyof typeof external]])) }));
    }
  } });
  try {
    const { default: Mod } = await import('../../src/entry/herdr-mod/main.ts');
    const start = async (setup?: (boundary: Boundary) => void) => {
      host = new Boundary(); setup?.(host); const view = new Mod(); host.view = view;
      view.init(undefined, host.context()); host.draw();
      await host.until(() => host.watches.length === 1);
      return host;
    };
    await t.test('other existing docs without taste offer initialization without guarded queries or categories', async () => {
      const b = await start(boundary => {
        boundary.files.delete('/repo/docs/taste.md');
        boundary.files.set('/repo/docs/architecture.md', '# Existing architecture\n');
      });
      try {
        assert.ok(b.output.find('initialize'));
        assert.equal(b.output.find('concord-tree'), undefined);
        assert.equal(b.output.find('new-feature'), undefined);
        assert.deepEqual(b.calls.filter(call => !['action', 'workspace'].includes(call[0]!)), [['doctor']]);
      } finally { b.close(); }
    });
    // @use-case docs/feature/herdr-mod/use-case/follow-changes.md
    await t.test('workspace timeouts keep waiting, accepted changes refresh, and background tabs stop waiting', async () => {
      const b = await start();
      try {
        const listed = () => b.calls.filter(call => call[0] === 'list').length;
        const before = listed();
        b.watches[0]!.result.resolve({ code: 0, stdout: JSON.stringify({ operation: 'workspace-wait', changed: false, sourceDigest: 'initial' }), stderr: '' });
        await b.until(() => b.watches.length === 2);
        assert.equal(listed(), before);
        b.watches[1]!.result.resolve({ code: 0, stdout: JSON.stringify({ operation: 'workspace-wait', changed: true, sourceDigest: 'changed' }), stderr: '' });
        await b.until(() => listed() > before && b.watches.length === 3);
        assert.deepEqual(b.calls.filter(call => call[0] === 'workspace').at(-1), ['workspace', 'wait', '--after', 'changed']);
        b.focusedTab = 't2'; b.draw();
        b.watches[2]!.result.resolve({ code: 0, stdout: JSON.stringify({ operation: 'workspace-wait', changed: true, sourceDigest: 'background' }), stderr: '' });
        await new Promise<void>(resolve => setImmediate(resolve));
        assert.equal(b.watches.length, 3);
        const background = listed(); b.focusedTab = 't1'; b.draw();
        await b.until(() => listed() > background && b.watches.length === 4);
      } finally { b.close(); }
    });
    await t.test('unavailable service falls back every two seconds and closes retained resources', async () => {
      const b = await start();
      b.watches[0]!.result.resolve({ code: 1, stdout: '', stderr: JSON.stringify({ error: 'HawdbUnavailable', message: 'Native unavailable' }) });
      await b.until(() => b.timers.some(timer => !timer.repeat && timer.ms === 2000));
      const before = b.calls.length; b.fire(2000);
      await b.until(() => b.calls.length > before && b.watches.length === 2);
      b.close();
      assert.ok(b.states.every(state => state.released));
      assert.ok(b.tasks.every(task => task.is_done()));
      const after = b.calls.length; b.fire(2000);
      assert.equal(b.calls.length, after);
      assert.deepEqual(b.errors, []);
    });
    await t.test('Markdown navigation, editor disposal and late watcher completion respect close', async () => {
      const b = await start();
      b.click(`page-${page}`);
      await b.until(() => b.output.find(`concord-body-${page}`) !== undefined);
      const markdown = b.output.find(`concord-body-${page}`)!;
      assert.ok(markdown.link); markdown.link('https://example.com/outside.md', b.context());
      b.click('edit'); b.draw();
      const editor = b.output.find('document-editor')!.state!;
      editor.set_value('# Draft\n');
      b.click('discard');
      await b.until(() => b.output.find(`concord-body-${page}`) !== undefined);
      assert.equal(editor.released, true);
      b.close();
      const before = b.calls.length;
      b.watches.at(-1)!.result.resolve({ code: 0, stdout: JSON.stringify({ operation: 'workspace-wait', changed: true, sourceDigest: 'late' }), stderr: '' });
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(b.calls.length, before);
      assert.ok(b.states.every(state => state.released));
      assert.deepEqual(b.errors, []);
    });
    await t.test('missing terminal shows its status without using stale space or focus cwd', async () => {
      host = new Boundary(); host.paneList = []; const view = new Mod(); host.view = view;
      view.init(undefined, host.context()); host.draw();
      await host.until(() => host.output.text().includes('先在这个 tab 里打开一个终端'));
      assert.equal(host.output.find('concord-tree'), undefined);
      assert.equal(host.output.find('new-feature'), undefined);
      assert.equal(host.output.find('choose-folder'), undefined);
      assert.equal(host.calls.length, 0); host.close();
    });
    await t.test('live pane cwd supplies missing focused cwd', async () => {
      const b = await start(boundary => { boundary.cwd = null; });
      assert.match(b.output.text(), /Cart/u); b.close();
    });
    await t.test('explicit overlay opens a right pane once or focuses its existing copy', () => {
      for (const existing of [false, true]) {
      host = new Boundary();
        if (existing) host.paneList.push({ pane: 'p2', terminal: null, mod: 'concord', cwd: null, focused: false, tab: 't1' });
        host.props = { overlay: 'mod-concord' };
        const view = new Mod(); host.view = view; view.init(undefined, host.context());
        assert.deepEqual(host.commands, existing ? [{ name: 'pane.focus', args: { pane: 'p2' } }] : [
          { name: 'pane.split', args: { pane: 'p1', direction: 'right', mod: 'concord', props: {} } },
        ]);
        assert.deepEqual(host.closedOverlays, ['mod-concord']);
        assert.equal(host.calls.length, 0); host.close();
      }
    });
    await t.test('missing CLI gates repository actions and can be detected after installation', async () => {
      host = new Boundary(); host.installedVersion = undefined;
      const view = new Mod(); host.view = view; view.init(undefined, host.context()); host.draw();
      await host.until(() => host.output.text().includes('curl -fsSL'));
      assert.equal(host.output.find('concord-tree'), undefined); assert.equal(host.calls.length, 0);
      host.installedVersion = 'dev'; host.click('recheck-cli');
      await host.until(() => host.watches.length === 1);
      assert.ok(host.output.find('concord-tree')); host.close();
    });
    // @use-case docs/feature/herdr-mod/use-case/use-on-remote-machine.md#open
    await t.test('remote queries and source reads use the space machine', async () => {
      host = new Boundary(); host.spaceList[0]!.machine = 'vps';
      const view = new Mod(); host.view = view; view.init(undefined, host.context()); host.draw();
      await host.until(() => host.output.find(`page-${page}`) !== undefined);
      host.click(`page-${page}`);
      await host.until(() => host.output.find(`concord-body-${page}`) !== undefined);
      assert.match(host.output.text(), /vps:\/repo/u);
      assert.equal(host.output.find('choose-folder'), undefined); assert.equal(host.output.find('refresh'), undefined);
      assert.ok(host.requests.every(request => request.options?.on === 'vps'));
      assert.ok(host.output.find('edit'));
      host.close();
    });
    // @use-case docs/feature/herdr-mod/use-case/init-from-herdr.md
    await t.test('live cwd follows the most recent terminal in its own tab, retaining same-root state', async () => {
      const b = await start();
      try {
        b.click(`page-${page}`);
        await b.until(() => b.output.find(`concord-body-${page}`) !== undefined);
        const before = b.calls.length;
        b.paneList[0]!.cwd = '/repo/src'; b.draw();
        await b.until(() => b.requests.some(request => request.options?.cwd === '/repo/src'));
        await new Promise<void>(resolve => setImmediate(resolve));
        assert.equal(b.calls.length, before, 'entering a subdirectory does not reload');
        assert.ok(b.output.find(`concord-body-${page}`));
        b.paneList.push({ pane: 'p2', terminal: 't2', tab: 't1', focused: true, cwd: '/other' });
        b.paneList[0]!.focused = false; b.draw();
        await b.until(() => b.output.find('initialize') !== undefined);
        assert.match(b.output.text(), /\/other/u);
        assert.ok(b.watches[0]!.root === '/repo' && b.watches.at(-1)!.root === '/other');
        b.paneList[1]!.focused = false;
        b.paneList.push({ pane: 'p3', terminal: 't3', tab: 't2', focused: true, cwd: '/repo' });
        b.focusedTab = 't2'; b.draw();
        assert.match(b.output.text(), /\/other/u, 'another tab cannot redirect this mod');
        b.paneList[1]!.cwd = '/repo'; b.draw();
        await b.until(() => b.output.find(`page-${page}`) !== undefined);
        assert.match(b.output.text(), /\/repo/u, 'mod focus preserves the most recently focused terminal');
      } finally { b.close(); }
    });
    // @use-case docs/feature/herdr-mod/use-case/init-from-herdr.md
    await t.test('saving or discarding a draft releases a pending repository switch', async () => {
      for (const action of ['save', 'discard']) {
        const b = await start();
        try {
          b.click(`page-${page}`); await b.until(() => b.output.find(`concord-body-${page}`) !== undefined);
          b.click('edit');
          const editor = b.output.find('document-editor')!.state!;
          editor.set_value('# Keep this draft\n');
          b.paneList[0]!.cwd = '/other'; b.draw();
          await b.until(() => b.output.text().includes('终端已切到 /other，保存或放弃修改后切换'));
          assert.equal(b.output.find('document-editor')!.state, editor);
          assert.equal(editor.value(), '# Keep this draft\n');
          assert.equal(b.output.find('initialize'), undefined);
          b.click(action);
          await b.until(() => b.output.find('initialize') !== undefined);
          assert.equal(editor.released, true);
          assert.equal(b.files.get(`/repo/${page}`), action === 'save' ? '# Keep this draft\n' : '# Cart\n');
          assert.match(b.output.text(), /\/other/u);
        } finally { b.close(); }
      }
    });
    // @use-case docs/feature/herdr-mod/use-case/init-from-herdr.md
    await t.test('a missing cwd and a non-repository directory have distinct automatic recovery states', async () => {
      const b = await start();
      try {
        b.paneList[0]!.cwd = null; b.draw();
        assert.match(b.output.text(), /先在这个 tab 里打开一个终端/u);
        assert.equal(b.output.find('concord-tree'), undefined);
        b.paneList[0]!.cwd = '/outside'; b.draw();
        await b.until(() => b.output.text().includes('这里不是 Git 仓库'));
        assert.match(b.output.text(), /\/outside/u);
        assert.match(b.output.text(), /在终端里 cd 到一个 Git 仓库，mod 会跟着切换/u);
        assert.equal(b.output.find('concord-tree'), undefined);
        b.paneList[0]!.cwd = '/repo'; b.draw();
        await b.until(() => b.output.find(`page-${page}`) !== undefined);
      } finally { b.close(); }
    });
    // @use-case docs/feature/herdr-mod/use-case/use-on-remote-machine.md#open
    await t.test('remote installation states name the machine and reconnect automatically', async () => {
      host = new Boundary(); host.spaceList[0]!.machine = 'vps'; host.reachable = false;
      const view = new Mod(); host.view = view; view.init(undefined, host.context()); host.draw();
      try {
        await host.until(() => host.output.text().includes('连不上 vps'));
        assert.match(host.output.text(), /Herdr 恢复连接后自动重试/u);
        assert.doesNotMatch(host.output.text(), /private diagnostic/u);
        host.reachable = true; host.installedVersion = undefined; host.fire(2000);
        await host.until(() => host.output.text().includes('vps 上没有 Concord 命令行工具'));
        assert.match(host.output.text(), /在 vps 的终端里运行安装命令，装好后点重新检测/u);
        host.installedVersion = 'dev'; host.click('recheck-cli');
        await host.until(() => host.output.find(`page-${page}`) !== undefined);
        assert.ok(host.requests.every(request => request.options?.on === 'vps'));
      } finally { host.close(); }
    });
    // @use-case docs/feature/herdr-mod/use-case/init-from-herdr.md
    await t.test('named command messages and folded raw diagnostics use status pages', async () => {
      for (const named of [false, true]) {
        host = new Boundary(); host.files.delete('/repo/docs/taste.md');
        host.commandError = { code: 1, stdout: '', stderr: named ? JSON.stringify({ error: 'ConfigurationInvalid', message: '配置需要修正' }) : 'raw private process output' };
        const view = new Mod(); host.view = view; view.init(undefined, host.context()); host.draw();
        try {
          await host.until(() => host.output.text().includes(named ? '配置需要修正' : 'Concord 命令失败'));
          assert.ok(host.output.find('concord-status')); assert.equal(host.output.find('concord-tree'), undefined);
          assert.doesNotMatch(host.output.text(), /raw private process output/u);
          if (!named) { host.click('error-details'); assert.match(host.output.text(), /raw private process output/u); }
        } finally { host.close(); }
      }
    });
  } finally { plugin.clearAll(); delete global.__concordHostSync; }
});
