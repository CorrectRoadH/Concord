/// <reference path="../../src/entry/herdr-mod/host.d.ts" />
import assert from 'node:assert/strict';
import { plugin } from 'bun';
import test from 'node:test';
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
  paneList: { pane: string; cwd: string | null; focused: boolean; tab: string; mod?: string }[] = [];
  spaceList: { id: string; folder: string; active: boolean; machine?: string | null }[] = [];
  commands: { name: string; args?: Record<string, unknown> }[] = [];
  closedOverlays: string[] = [];
  installedVersion: string | undefined = 'dev';
  minimumVersion = 'dev';
  props: Record<string, unknown> = {};
  files = new Map([[`/repo/${page}`, '# Cart\n'], ['/repo/docs/taste.md', '# Taste\n']]);
  calls: string[][] = [];
  watches: { root: string; result: ReturnType<typeof pending<string[]>> }[] = [];
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
  async exec(command: string, args: string[], options?: { cwd: string }) {
    assert.equal(command, 'concord');
    if (args[0] === '--version') {
      if (this.installedVersion === undefined) throw new Error('cannot start concord');
      return { code: 0, stdout: `concord v${this.installedVersion}\n`, stderr: '' };
    }
    assert.equal(options?.cwd, '/repo');
    const operation = args.includes('--root') ? args.slice(args.indexOf('--root') + 2) : args.slice(2); this.calls.push(operation);
    const data = operation[0] === 'doctor' ? { root: '/repo', configuration: { sourceRoots: ['src'], testRoots: ['test'] } }
      : operation[0] === 'list' ? { documents: [{ path: page, kind: 'feature', title: 'Cart' }] }
      : operation[0] === 'concepts' ? { concepts: [], catalogs: [] }
      : operation[0] === 'show' ? { pages: [{ path: page, name: 'Cart', kind: 'readme' }] }
      : {};
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
  exec: (command: string, args: string[], options?: { cwd: string }) => host.exec(command, args, options),
  readTextFile: async (path: string) => path === '/herdr/mods/concord/mod.json' ? JSON.stringify({ minimumConcordVersion: host.minimumVersion }) : host.files.get(path) ?? null,
  writeTextFile: async (path: string, source: string, expected: string | null) => {
    assert.equal(host.files.get(path) ?? null, expected); host.files.set(path, source); return null;
  },
  watchFolder: (root: string) => { const result = pending<string[]>(); host.watches.push({ root, result }); return result.promise; },
  pickFolder: () => host.picker.promise,
  focused: () => host.cwd === null ? null : ({ cwd: host.cwd, pane: null, terminal: null, shown: null, agent: null, space: 's1', tab: 't1' }),
  panes: () => host.paneList, spaces: () => host.spaceList,
  run: (name: string, args?: Record<string, unknown>) => { host.commands.push({ name, args }); return null; },
  closeOverlay: (id: string) => { host.closedOverlays.push(id); return null; },
  appHome: () => '/herdr',
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
    herdr: ['exec', 'readTextFile', 'writeTextFile', 'watchFolder', 'pickFolder', 'focused', 'panes', 'spaces', 'run', 'closeOverlay', 'appHome', 'props', 'theme'],
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
        assert.deepEqual(b.calls, [['doctor']]);
      } finally { b.close(); }
    });
    await t.test('root invalidations refresh, unrelated paths do not, and bursts debounce', async () => {
      const b = await start();
      try {
        b.watches[0]!.result.resolve(['/repo/unrelated.txt']);
        await b.until(() => b.watches.length === 2);
        assert.equal(b.timers.length, 0);
        b.watches[1]!.result.resolve(['/repo']);
        await b.until(() => b.watches.length === 3);
        assert.equal(b.timers.length, 1);
        b.watches[2]!.result.resolve(['/repo/docs/taste.md']);
        await b.until(() => b.watches.length === 4);
        assert.equal(b.timers[0]!.task.cancelled, true);
        const before = b.calls.length; b.fire(200);
        await b.until(() => b.calls.length > before);
        assert.equal(b.watches.length, 4, 'refresh retains its single watch loop');
      } finally { b.close(); }
    });
    await t.test('watch rejection polls with timer contexts and closes all retained resources', async () => {
      const b = await start();
      b.watches[0]!.result.reject(new Error('exceeds 4096 watch directories'));
      await b.until(() => b.timers.some(timer => timer.repeat));
      const before = b.calls.length; b.fire(1000);
      await b.until(() => b.calls.length > before);
      b.close();
      assert.ok(b.states.every(state => state.released));
      assert.ok(b.tasks.every(task => task.is_done()));
      const after = b.calls.length; b.fire(1000); b.fire(200);
      assert.equal(b.calls.length, after);
      await b.until(() => b.errors.length === 0);
    });
    await t.test('Markdown navigation, editor disposal and late watcher/picker completion respect close', async () => {
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
      b.click('choose-folder'); b.close();
      const before = b.calls.length;
      b.watches.at(-1)!.result.resolve(['/repo']); b.picker.resolve('/elsewhere');
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(b.calls.length, before);
      assert.ok(b.states.every(state => state.released));
      assert.deepEqual(b.errors, []);
    });
    await t.test('missing focused terminal offers folder selection without starting commands', async () => {
      host = new Boundary(); host.cwd = null; const view = new Mod(); host.view = view;
      view.init(undefined, host.context()); host.draw();
      await host.until(() => host.output.text().includes('没有可用的当前目录'));
      assert.equal(host.output.find('concord-tree'), undefined);
      assert.equal(host.output.find('new-feature'), undefined);
      assert.ok(host.output.find('choose-folder'));
      assert.equal(host.calls.length, 0); host.close();
    });
    await t.test('pane cwd and then current space folder supply missing focused cwd', async () => {
      for (const from of ['pane', 'space']) {
        const b = await start(boundary => {
          boundary.cwd = null;
          boundary.spaceList = [{ id: 's1', folder: from === 'space' ? '/repo' : '/unused', active: true }];
          if (from === 'pane') boundary.paneList = [{ pane: 'p1', cwd: '/repo', focused: true, tab: 't1' }];
        });
        assert.match(b.output.text(), /Cart/u); b.close();
      }
    });
    await t.test('explicit overlay opens a right pane once or focuses its existing copy', () => {
      for (const existing of [false, true]) {
        host = new Boundary(); host.paneList = [{ pane: 'p1', cwd: '/repo', focused: true, tab: 't1' }];
        if (existing) host.paneList.push({ pane: 'p2', mod: 'concord', cwd: null, focused: false, tab: 't1' });
        host.props = { overlay: 'mod-concord' };
        const view = new Mod(); host.view = view; view.init(undefined, host.context());
        assert.deepEqual(host.commands, existing ? [{ name: 'pane.focus', args: { pane: 'p2' } }] : [
          { name: 'pane.split', args: { pane: 'p1', direction: 'right', mod: 'concord', props: { cwd: '/repo' } } },
        ]);
        assert.deepEqual(host.closedOverlays, ['mod-concord']);
        assert.equal(host.calls.length, 0); host.close();
      }
    });
    await t.test('missing, outdated and newer CLI versions gate repository actions and recheck', async () => {
      host = new Boundary(); host.installedVersion = undefined; host.minimumVersion = '2.3.4';
      const view = new Mod(); host.view = view; view.init(undefined, host.context()); host.draw();
      await host.until(() => host.output.text().includes('curl -fsSL'));
      assert.equal(host.output.find('concord-tree'), undefined); assert.equal(host.calls.length, 0);
      host.installedVersion = '2.3.3'; host.click('recheck-cli');
      await host.until(() => host.output.text().includes('当前版本：2.3.3'));
      assert.match(host.output.text(), /最低版本：2.3.4/u); assert.match(host.output.text(), /install.sh/u);
      assert.equal(host.calls.length, 0);
      host.installedVersion = '2.4.0'; host.click('recheck-cli');
      await host.until(() => host.watches.length === 1);
      assert.match(host.output.text(), /concord herdr install/u); host.close();
    });
    await t.test('remote space only shows its local-pane restriction', () => {
      host = new Boundary(); host.spaceList = [{ id: 's1', folder: '/repo', active: true, machine: 'remote' }];
      const view = new Mod(); host.view = view; view.init(undefined, host.context()); host.draw();
      assert.match(host.output.text(), /Concord mod 只能用于本机的 pane/u);
      assert.equal(host.calls.length, 0); assert.equal(host.tasks.length, 0); host.close();
    });
  } finally { plugin.clearAll(); delete global.__concordHostSync; }
});
