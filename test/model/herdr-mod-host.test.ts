/// <reference path="../../src/entry/herdr-mod/host.d.ts" />
import assert from 'node:assert/strict';
import { plugin } from 'bun';
import { mock } from 'bun:test';
import test from 'node:test';
import { digest } from '../../src/model/index.ts';
import type { RenderedPage } from '../../src/model/herdr-mod/index.ts';
import type { AsyncContext, Context, Task } from 'gpui-kit';

// Only the GPUI/Herdr host boundary is simulated. The source View and Effect
// session run unchanged, including scheduling and public command decoding.
class Element {
  key = '';
  nodes: (Element | string)[] = [];
  click: ((event: unknown, cx: Context) => void) | undefined;
  link: ((url: string, cx: Context) => void) | undefined;
  state: State | undefined;
  scroll: State | undefined;
  width: number | undefined;
  pointer = false;
  hovered = false;
  sizeChanged: ((size: { width: number; height: number }, cx: Context) => void) | undefined;
  private consumed = false;
  id(key: string) { this.key = key; return this; }
  child(child: Element | string) {
    if (child instanceof Element) { assert.equal(child.consumed, false, 'native element has one parent'); child.consumed = true; }
    this.nodes.push(child); return this;
  }
  children(children: readonly (Element | string)[]) { children.forEach(child => this.child(child)); return this; }
  size_full() { return this; } flex_1() { return this; } min_w(_v: number) { return this; } min_h(_v: number) { return this; }
  max_w(_v: number) { return this; } items_center() { return this; } items_start() { return this; } justify_center() { return this; }
  max_w_full() { return this; }
  w(v: number) { this.width = v; return this; } h(_v: number) { return this; } gap(_v: number) { return this; }
  p(_v: number) { return this; } px(_v: number) { return this; } py(_v: number) { return this; }
  bg(_v: string) { return this; } text_color(_v: string) { return this; } text_size(_v: number) { return this; }
  rounded(_v: number) { return this; } overflow_y_scroll() { return this; }
  items_stretch() { return this; } overflow_hidden() { return this; }
  size(_v: number) { return this; } flex_none() { return this; }
  pl(_v: number) { return this; } pr(_v: number) { return this; }
  border_1() { return this; } border_b(_v: number) { return this; } border_r(_v: number) { return this; } border_t(_v: number) { return this; } border_color(_v: string) { return this; }
  cursor_pointer() { this.pointer = true; return this; } truncate() { return this; } font_semibold() { return this; } font_family(_v: string) { return this; }
  hover(_body: (element: Element) => Element) { this.hovered = true; return this; }
  on_size_change(body: (size: { width: number; height: number }, cx: Context) => void) { this.sizeChanged = body; return this; }
  track_scroll(handle: State) { this.scroll = handle; return this; }
  on_click(body: (event: unknown, cx: Context) => void) {
    // herdr-app refuses handlers registered while a virtual list lays out its rows.
    if (listLayout > 0) throw new Error('on_click inside a virtual list renderer');
    this.click = body; return this;
  }
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
  readOnly = false;
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
  commandGate: ReturnType<typeof pending<void>> | undefined;
  commands: { name: string; args?: Record<string, unknown> }[] = [];
  closedOverlays: string[] = [];
  urls: string[] = [];
  clipboard = '';
  rendered: RenderedPage['blocks'] | undefined;
  packagePages = [{ path: page, name: 'Cart', kind: 'readme' }];
  documents = [{ path: page, kind: 'feature', title: 'Cart' }];
  conceptCatalogs: { path: string; catalog: { title: string } }[] = [];
  concepts: { reference: string; path: string; concept: { id: string; term: string; definition: string } }[] = [];
  relationships: { tests: { file: string; line: number; name: string; contract: string }[]; codeDeclarations: { file: string; line: number; symbol: string; contracts: string[] }[] } = { tests: [], codeDeclarations: [] };
  colors: Record<string, string> = {};
  resourceFiles = new Map<string, Uint8Array>();
  imagePaths: string[] = [];
  beforeUnlink: (() => Promise<void>) | undefined;
  renderGate: ReturnType<typeof pending<void>> | undefined;
  beforeRoot: ((cwd: string) => Promise<void>) | undefined;
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
  frames: Element[] = [];
  view: { render(cx: Context): unknown; close(cx: AsyncContext): void | Promise<void> } | undefined;
  task(): HostTask {
    const task = { done: false, cancelled: false, cancel() { this.cancelled = true; }, is_done() { return this.done || this.cancelled; } };
    this.tasks.push(task); return task;
  }
  context(owner?: HostTask): AsyncContext {
    return {
      stop_propagation() {},
      open_url: url => { this.urls.push(url); },
      write_to_clipboard: value => { this.clipboard = value; },
      sleep: () => new Promise(resolve => setImmediate(resolve)),
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
  draw() { if (this.view) { this.output = this.view.render(this.context()) as Element; this.frames.push(this.output); } }
  selectTab(tab: string, cwd: string, machine: string | null = null) {
    this.focusedTab = tab;
    for (const pane of this.paneList) pane.focused = false;
    if (!this.paneList.some(pane => pane.tab === tab)) this.paneList.push({ pane: `pane-${tab}`, terminal: `terminal-${tab}`, tab, cwd, focused: true });
    if (!this.spaceList.some(space => space.tabs.some(item => item.id === tab))) this.spaceList.push({ id: `space-${tab}`, folder: '/unused', active: true, machine, tabs: [{ id: tab, active: true }] });
    for (const space of this.spaceList) {
      space.active = space.tabs.some(item => item.id === tab);
      for (const item of space.tabs) item.active = item.id === tab;
    }
    this.draw();
  }
  click(key: string) { const element = this.output.find(key); assert.ok(element?.click, key); element.click(undefined, this.context()); }
  state(value = '') { const state = new State(value); this.states.push(state); return state; }
  async exec(command: string, args: string[], options?: { cwd?: string; on?: string | null }) {
    this.requests.push({ command, args, options });
    if (options?.on && !this.reachable) throw new Error('transport unavailable: private diagnostic');
    if (command === 'git' || command === 'sh') {
      const root = this.roots.get(options?.cwd ?? '');
      await this.beforeRoot?.(options?.cwd ?? '');
      return { code: root ? 0 : 128, stdout: root ? command === 'sh' ? `/home/remote\n${root}\n` : `${root}\n` : '', stderr: root ? '' : 'fatal: not a git repository' };
    }
    assert.equal(command, 'concord');
    if (args[0] === '--version') {
      if (this.installedVersion === undefined) throw new Error('cannot start concord');
      return { code: 0, stdout: `concord v${this.installedVersion}\n`, stderr: '' };
    }
    await this.commandGate?.promise;
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
      if (input.action === 'page.render') {
        const reply = { code: 0, stdout: JSON.stringify({ path: input.path, blocks: this.rendered ?? [{ type: 'markdown', text: source ?? '' }] }), stderr: '' };
        await this.renderGate?.promise; return reply;
      }
      assert.equal(input.action, 'document.set');
      if (source === undefined || digest(source) !== input.expectedDigest) return error('FileChangedSinceRead');
      this.files.set(absolute, input.body);
      return { code: 0, stdout: JSON.stringify({ changedPaths: [input.path] }), stderr: '' };
    }
    const data = operation[0] === 'doctor' ? { root: this.roots.get(options?.cwd ?? '') ?? options?.cwd, configuration: { sourceRoots: ['src'], testRoots: ['test'] } }
      : operation[0] === 'list' ? { documents: this.documents }
      : operation[0] === 'concepts' ? { concepts: this.concepts, catalogs: this.conceptCatalogs }
      : operation[0] === 'show' ? { pages: this.packagePages, ...this.relationships }
      : operation[0] === 'init' ? { createdPaths: ['docs/taste.md'], guide: 'docs-from-scratch' }
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
  async close() { await this.view!.close(this.context()); this.closed = true; }
}
let host: Boundary;
let listLayout = 0;
const sharedData = new Map<string, unknown>();
const external = {
  View: class {}, div: () => new Element(), h_flex: () => new Element(), v_flex: () => new Element(),
  svg: () => new Element(),
  v_virtual_list: (id: string, count: number, _height: number, _key: (index: number) => string, render: (range: { start: number; end: number }, cx: Context) => Element[]) => {
    listLayout++;
    try { return new Element().id(id).children(render({ start: 0, end: count }, host.context())); } finally { listLayout--; }
  },
  VirtualListScrollHandle: { new: () => host.state('') },
  image: (path: string) => { assert.ok(host.resourceFiles.has(`/herdr/${path}`), 'write finishes before native image loading'); host.imagePaths.push(path); return new Element().child(`IMAGE ${path}`); },
  TextView: { markdown: (id: string, source: string) => new Element().id(id).child(source) },
  EditorState: { new: (options?: { value?: string; readonly?: boolean }) => { const state = host.state(options?.value); state.readOnly = options?.readonly ?? false; return state; } },
  Editor: { new: (state: State) => { const element = new Element(); element.state = state; return element; } },
  exec: (command: string, args: string[], options?: { cwd?: string; on?: string | null }) => host.exec(command, args, options),
  focused: () => ({ cwd: host.cwd, pane: host.paneList.find(pane => pane.focused)?.pane ?? null, terminal: null, shown: null, agent: null, space: 's1', tab: host.focusedTab }),
  panes: () => host.paneList, spaces: () => host.spaceList,
  run: (name: string, args?: Record<string, unknown>) => { host.commands.push({ name, args }); return null; },
  closeOverlay: (id: string) => { host.closedOverlays.push(id); return null; },
  appHome: () => '/herdr',
  home: () => '/home/local',
  props: () => host.props,
  theme: () => host.colors,
  settings: () => ({ font_family: 'Test Mono' }),
  shared: (key: string) => structuredClone(sharedData.get(key)),
  setShared: (key: string, value: unknown) => { sharedData.set(key, structuredClone(value)); return null; },
};
const global = globalThis as typeof globalThis & { __concordHostSync?: typeof external };

// @use-case docs/feature/herdr-mod/use-case/follow-changes.md
test('source mod obeys native host invalidation and retained-state boundaries', async t => {
  global.__concordHostSync = external;
  const names: Record<string, string[]> = {
    'gpui-kit': ['View', 'div', 'image', 'svg'],
    'gpui-base': ['h_flex', 'v_flex', 'v_virtual_list', 'VirtualListScrollHandle', 'TextView', 'Editor', 'EditorState'],
    herdr: ['exec', 'focused', 'panes', 'spaces', 'run', 'closeOverlay', 'appHome', 'home', 'props', 'theme', 'settings', 'shared', 'setShared'],
  };
  mock.module('fs/promises', () => ({
      mkdir: async () => undefined,
      readdir: async (path: string) => [...host.resourceFiles.keys()].filter(file => file.startsWith(`${path}/`)).map(file => file.slice(path.length + 1)),
      writeFile: async (path: string, bytes: Uint8Array) => { host.resourceFiles.set(path, bytes.slice()); },
      unlink: async (path: string) => { const current = host; await current.beforeUnlink?.(); current.resourceFiles.delete(path); },
  }));
  plugin({ name: 'concord-test-herdr-host', setup(build) {
    for (const [specifier, members] of Object.entries(names)) {
      build.module(specifier, () => ({ loader: 'object', exports: Object.fromEntries(members.map(name => [name, external[name as keyof typeof external]])) }));
    }
  } });
  try {
    const { default: Mod } = await import('../../src/entry/herdr-mod/main.ts');
    const start = async (setup?: (boundary: Boundary) => void, ready = () => host.watches.length === 1) => {
      host = new Boundary(); setup?.(host); const view = new Mod(); host.view = view;
      view.init(undefined, host.context()); host.draw();
      await host.until(ready);
      return host;
    };
    // @feature docs/feature/herdr-mod/ui.md#双栏
    await t.test('both columns remain at all widths and the collapsed list survives refresh, selection and repository changes', async () => {
      const b = await start();
      try {
        for (const [width, expected] of [[320, 160], [480, 192], [900, 240]]) {
          b.output.sizeChanged!({ width: width!, height: 600 }, b.context());
          assert.equal(b.output.find('concord-sidebar')!.width, expected);
          assert.ok(b.output.find('concord-page')); assert.ok(b.output.find('concord-tree'));
        }
        b.click(`page-${page}`);
        await b.until(() => b.output.find(`concord-body-${page}`) !== undefined);
        const scroll = b.output.find('concord-tree')!.scroll;
        b.click('toggle-documents');
        assert.equal(b.output.find('concord-tree'), undefined);
        b.output.find(`concord-block-${page}-0`)!.link!('../../taste.md', b.context());
        await b.until(() => b.output.find('concord-body-docs/taste.md') !== undefined);
        assert.equal(b.output.find('concord-tree'), undefined);
        b.watches.at(-1)!.result.resolve({ code: 0, stdout: JSON.stringify({ operation: 'workspace-wait', changed: true, sourceDigest: 'new' }), stderr: '' });
        await b.until(() => b.watches.length > 1);
        assert.equal(b.output.find('concord-tree'), undefined);
        b.paneList[0]!.cwd = '/other'; b.draw();
        await b.until(() => b.output.find('initialize') !== undefined);
        b.paneList[0]!.cwd = '/repo'; b.draw();
        await b.until(() => b.output.find('toggle-documents') !== undefined);
        assert.equal(b.output.find('concord-tree'), undefined);
        b.click('toggle-documents');
        assert.ok(b.output.find('concord-tree'));
        assert.equal(b.output.find('concord-tree')!.scroll, scroll, 'the retained native scroll handle survives unmounts');
      } finally { await b.close(); }
    });
    // @feature docs/feature/herdr-mod/ui.md#文档列表
    // @issue docs/issues/herdr-mod-empty-tree.md
    await t.test('the document list draws its groups and rows under the native list rules', async () => {
      const b = await start();
      try {
        assert.ok(b.output.find('category-Feature'), 'group headings are drawn');
        assert.ok(b.output.find(`page-${page}`), 'package rows are drawn');
        b.click(`page-${page}`);
        await b.until(() => b.output.find(`concord-body-${page}`) !== undefined);
      } finally { await b.close(); }
    });
    // @feature docs/feature/herdr-mod/ui.md#文档列表
    await t.test('package arrows only fold, titles open README, and refresh or resizing preserves expansion and click affordances', async () => {
      const casePath = 'docs/feature/cart/use-case/add.md', caseRoot = 'docs/feature/cart/use-case';
      const b = await start(boundary => {
        boundary.packagePages.push({ path: casePath, name: '加入商品', kind: 'use-case' }, { path: `${caseRoot}/README.md`, name: 'Use Cases', kind: 'page' });
        boundary.files.set(`/repo/${casePath}`, '# 加入商品\n');
        boundary.files.set(`/repo/${caseRoot}/README.md`, '# Use Cases\n');
      });
      try {
        assert.equal(b.output.find(`page-${casePath}`), undefined, 'packages start folded');
        const heading = b.output.find('category-Feature')!;
        assert.ok(heading.click); assert.equal(heading.pointer, true); assert.equal(heading.hovered, true);
        b.click('category-Feature'); assert.equal(b.output.find(`page-${page}`), undefined);
        b.click('category-Feature'); assert.ok(b.output.find(`page-${page}`));
        const repository = b.output.find('concord-repository')!;
        assert.equal(repository.click, undefined); assert.equal(repository.pointer, false); assert.equal(repository.hovered, false);
        assert.equal(b.output.find('category-Issue'), undefined, 'empty groups are absent');
        b.click('toggle-docs/feature/cart');
        assert.equal(b.output.find(`concord-body-${page}`), undefined, 'arrow did not open the README');
        b.click(`page-${caseRoot}/README.md`);
        await b.until(() => b.output.find(`concord-body-${caseRoot}/README.md`) !== undefined);
        assert.ok(b.output.find(`page-${casePath}`));
        assert.equal(b.output.find(`tree-row-${caseRoot}/README.md`), undefined, 'README is represented by its directory');
        b.click(`page-${casePath}`);
        await b.until(() => b.output.find(`concord-body-${casePath}`) !== undefined);
        assert.equal(b.output.find('page-toolbar')!.nodes[0] instanceof Element && (b.output.find('page-toolbar')!.nodes[0] as Element).pointer, false);
        b.output.sizeChanged!({ width: 400, height: 600 }, b.context());
        assert.ok(b.output.find(`page-${casePath}`));
        b.watches.at(-1)!.result.resolve({ code: 0, stdout: JSON.stringify({ operation: 'workspace-wait', changed: true, sourceDigest: 'tree-refresh' }), stderr: '' });
        await b.until(() => b.watches.length > 1);
        assert.ok(b.output.find(`page-${casePath}`));
        const link = b.output.find(`page-${casePath}`)!;
        assert.equal(link.pointer, true); assert.equal(link.hovered, true);
        b.click('toggle-docs/feature/cart');
        assert.equal(b.output.find(`page-${casePath}`), undefined);
        assert.ok(b.output.find(`concord-body-${casePath}`), 'collapsing preserves the selected page');
      } finally { await b.close(); }
    });
    // @feature docs/feature/herdr-mod/ui.md#出错时
    await t.test('a folded error banner keeps the page and list, can be dismissed, and clears after a successful read', async () => {
      const b = await start();
      try {
        b.click(`page-${page}`); await b.until(() => b.output.find(`concord-body-${page}`) !== undefined);
        const error = 'raw private process output';
        for (const dismiss of [true, false]) {
          b.commandError = { code: 1, stdout: '', stderr: error };
          b.output.find(`concord-block-${page}-0`)!.link!('../../architecture.md', b.context());
          await b.until(() => b.output.find('concord-error') !== undefined);
          assert.ok(b.output.find(`concord-body-${page}`)); assert.ok(b.output.find('concord-tree'));
          assert.doesNotMatch(b.output.text(), /raw private process output/u);
          assert.doesNotMatch(b.output.find(`concord-body-${page}`)!.text(), /Concord 命令失败/u);
          b.click('copy-error'); assert.match(b.clipboard, /Concord 命令失败[\s\S]*原始输出：\nraw private process output/u);
          assert.doesNotMatch(b.output.text(), /raw private process output/u);
          if (dismiss) { b.click('dismiss-error'); assert.equal(b.output.find('concord-error'), undefined); }
          b.commandError = undefined;
          b.click(`page-${page}`);
          await b.until(() => b.output.find('concord-error') === undefined);
          assert.ok(b.output.find(`concord-body-${page}`));
        }
      } finally { await b.close(); }
    });
    // @feature docs/feature/herdr-mod/ui.md#文档列表
    await t.test('the document model groups packages and catalogs with their titles and opens collapsed groups from links', async () => {
      const b = await start(boundary => {
        for (const [path, kind, title] of [
          ['docs/engineering/build/README.md', 'engineering', '构建'],
          ['docs/roadmap/next/README.md', 'roadmap', '下一步'],
          ['docs/design/choice.md', 'design', '取舍'], ['docs/issues/broken.md', 'issue', '待修复'], ['memory/lesson.md', 'memory', '经验'],
        ]) {
          boundary.documents.push({ path: path!, kind: kind!, title: title! });
          boundary.packagePages.push({ path: path!, kind: kind!, name: title! });
          boundary.files.set(`/repo/${path}`, `# ${title}\n`);
        }
        boundary.files.set('/repo/docs/writing.md', '# 写作规则\n');
        boundary.files.set('/repo/docs/architecture.md', '# 全局架构\n');
        boundary.files.set('/repo/docs/feature/cart/concepts.md', '# 购物车术语表\n');
        boundary.packagePages.push({ path: 'docs/feature/cart/concepts.md', kind: 'concepts', name: 'concepts' });
        boundary.conceptCatalogs.push({ path: 'docs/feature/cart/concepts.md', catalog: { title: '购物车术语表' } });
      });
      try {
        const categories = b.output.find('concord-tree')!.nodes.filter((node): node is Element => node instanceof Element && node.key.startsWith('category-')).map(node => node.key);
        assert.deepEqual(categories, ['Feature', 'Engineering', 'Roadmap', '项目规则', 'Design', 'Issue', 'Memory', '其它文档'].map(group => `category-${group}`));
        assert.ok(b.output.find('page-docs/engineering/build/README.md'));
        assert.equal(b.output.find('page-docs/roadmap/next/README.md'), undefined);
        assert.equal(b.output.find('page-docs/writing.md'), undefined);
        b.click('category-项目规则');
        assert.ok(b.output.find('page-docs/writing.md'));
        assert.equal(b.output.find('page-docs/feature/cart/concepts.md')!.text().trim(), '购物车术语表');
        b.click('category-项目规则');
        b.click(`page-${page}`); await b.until(() => b.output.find(`concord-body-${page}`) !== undefined);
        b.output.find(`concord-block-${page}-0`)!.link!('../../writing.md', b.context());
        await b.until(() => b.output.find('concord-body-docs/writing.md') !== undefined);
        assert.ok(b.output.find('page-docs/writing.md'), 'following the link automatically expands its group');
        assert.equal(b.output.find('new-feature'), undefined, 'new documents are created in the conversation');
      } finally { await b.close(); }
    });
    // @feature docs/feature/herdr-mod/ui.md#页面视图
    await t.test('relationship rows open readonly source and concept links show a dismissible definition card above the body', async () => {
      const b = await start(boundary => {
        boundary.files.set(`/repo/${page}`, '# Cart\n\n1. 加入商品。 {#add}\n');
        boundary.files.set('/repo/src/cart.ts', 'export const addItem = 1;\n');
        boundary.files.set('/repo/test/cart.ts', 'test("adds an item");\n');
        boundary.files.set('/repo/docs/concepts.md', '# Terms\n\nUnrelated definition\n');
        boundary.concepts.push({ reference: 'docs/concepts.md#cart', path: 'docs/concepts.md', concept: { id: 'cart', term: '购物车', definition: '商品和数量的集合。' } });
        boundary.relationships.tests.push({ file: 'test/cart.ts', line: 1, name: 'adds an item', contract: `${page}#add` });
        boundary.relationships.codeDeclarations.push({ file: 'src/cart.ts', line: 1, symbol: 'addItem', contracts: [`${page}#add`] });
      });
      try {
        b.click(`page-${page}`); await b.until(() => b.output.find(`code-${page}#add-0`) !== undefined);
        assert.match(b.output.find('concord-relationships')!.text(), /守护它的测试[\s\S]*加入商品[\s\S]*adds an item[\s\S]*实现它的代码[\s\S]*addItem/u);
        b.click(`code-${page}#add-0`);
        await b.until(() => b.output.find('concord-source-preview') !== undefined);
        assert.match(b.output.find('concord-source-preview')!.text(), /src\/cart.ts:1/u);
        assert.equal(b.output.find('concord-source-editor')!.state!.readOnly, true);
        assert.match(b.output.find('concord-source-editor')!.state!.value(), /export const addItem = 1/u);
        b.click('close-preview'); assert.equal(b.output.find('concord-source-preview'), undefined);
        b.output.find(`concord-block-${page}-0`)!.link!('../../concepts.md#cart', b.context());
        const card = b.output.find('concord-concept-card')!;
        assert.match(card.text(), /购物车[\s\S]*商品和数量的集合。[\s\S]*docs\/concepts.md/u);
        assert.doesNotMatch(card.text(), /Unrelated definition/u);
        b.click('close-concept'); assert.equal(b.output.find('concord-concept-card'), undefined);
        assert.ok(b.output.find(`concord-body-${page}`));
      } finally { await b.close(); }
    });
    // @use-case docs/feature/herdr-mod/use-case/read-spec.md
    await t.test('native blocks load completed files, expose Mermaid source and open an offline p5 file, then react to theme changes', async () => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>', html = '<!doctype html><title>p5</title>';
      const b = await start(boundary => { boundary.rendered = [
        { type: 'markdown', text: '# Rich page' },
        { type: 'image', source: 'plot.svg', alt: 'Plot', mediaType: 'image/svg+xml', data: Buffer.from(svg).toString('base64'), digest: digest(svg) },
        { type: 'mermaid', source: 'flowchart LR\nA --> B', svg, digest: digest(svg) },
        { type: 'p5', source: 'p.describe("Sketch")', description: 'Sketch', html },
        { type: 'image', source: 'gone.png', alt: 'Missing plot', error: '图片不存在' },
      ]; });
      try {
        b.click(`page-${page}`); await b.until(() => b.output.find(`concord-body-${page}`) !== undefined);
        assert.equal(b.resourceFiles.size, 2, 'identical image bytes share one file');
        assert.match(b.output.text(), /Missing plot · gone.png · 图片不存在/u);
        assert.equal(b.output.find(`concord-block-${page}-2-source`), undefined);
        b.click(`concord-block-${page}-2-toggle`); assert.match(b.output.text(), /flowchart LR/u);
        b.click(`concord-block-${page}-3-play`); assert.match(b.urls[0]!, /^file:\/\/\/herdr\/data\/concord\/render\/[a-f0-9]{64}\.html$/u);
        const renders = () => b.calls.filter(call => call[0] === 'action' && call.some(arg => arg.includes('page.render'))).length;
        const beforeRefresh = renders();
        b.rendered = [{ type: 'markdown', text: 'Changed dependency with unchanged Markdown' }];
        b.watches.at(-1)!.result.resolve({ code: 0, stdout: JSON.stringify({ operation: 'workspace-wait', changed: true, sourceDigest: 'dependency-change' }), stderr: '' });
        await b.until(() => renders() > beforeRefresh && b.output.text().includes('Changed dependency with unchanged Markdown'));
        assert.equal(b.resourceFiles.size, 0, 'refresh releases assets removed from the rendered page');
        b.rendered = [
          { type: 'image', source: 'plot.svg', alt: 'Plot', mediaType: 'image/svg+xml', data: Buffer.from(svg).toString('base64'), digest: digest(svg) },
          { type: 'p5', source: 'p.describe("Sketch")', description: 'Sketch', html },
        ];
        const before = renders(); b.colors = { foreground: '#123456' }; b.draw();
        await b.until(() => renders() > before && b.output.find(`concord-body-${page}`) !== undefined);
        assert.equal(b.resourceFiles.size, 2);
        await b.close(); assert.equal(b.resourceFiles.size, 0);
      } finally { if (!b.closed) await b.close(); }
    });
    // @use-case docs/feature/herdr-mod/use-case/read-spec.md
    await t.test('an identical file acquired during final release survives, and only the last instance removes it', async () => {
      const b = await start();
      const { RenderAssets } = await import('../../src/entry/herdr-mod/render-assets.ts');
      const a = new RenderAssets(), other = new RenderAssets(); a.start(b.context()); other.start(b.context());
      const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>', pageData = { path: page, blocks: [{ type: 'mermaid' as const, source: 'flowchart LR', svg, digest: digest(svg) }] };
      try {
        const first = await a.prepare(pageData, b.context(), () => true); assert.ok(first);
        const second = await other.prepare(pageData, b.context(), () => true); assert.ok(second);
        await first.release(b.context()); assert.equal(b.resourceFiles.size, 1);
        const entered = pending<void>(), unblock = pending<void>();
        b.beforeUnlink = async () => { entered.resolve(); await unblock.promise; };
        const releasing = other.close(b.context()); await entered.promise;
        let ready = false;
        const replacement = a.prepare(pageData, b.context(), () => true).then(value => { ready = true; return value; });
        await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(ready, false);
        b.beforeUnlink = undefined; unblock.resolve(); await releasing;
        const acquired = await replacement; assert.ok(acquired); assert.equal(b.resourceFiles.size, 1);
        await acquired.release(b.context()); assert.equal(b.resourceFiles.size, 0);
      } finally { b.beforeUnlink = undefined; await a.close(b.context()); await other.close(b.context()); await b.close(); }
    });
    // @use-case docs/feature/herdr-mod/use-case/follow-changes.md
    await t.test('a rendered page arriving after close creates no assets or notifications', async () => {
      const b = await start(); const gate = pending<void>(); b.renderGate = gate;
      b.click(`page-${page}`);
      await b.until(() => b.calls.some(call => call.some(arg => arg.includes('page.render'))));
      await b.close(); gate.resolve();
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(b.resourceFiles.size, 0); assert.deepEqual(b.errors, []);
    });
    await t.test('other existing docs without taste offer initialization without guarded queries or categories', async () => {
      const b = await start(boundary => {
        boundary.files.delete('/repo/docs/taste.md');
        boundary.files.set('/repo/docs/architecture.md', '# Existing architecture\n');
      }, () => host.output.find('initialize') !== undefined);
      try {
        assert.ok(b.output.find('initialize'));
        assert.equal(b.output.find('concord-tree'), undefined);
        assert.equal(b.output.find('new-feature'), undefined);
        assert.deepEqual(b.calls.filter(call => !['action', 'workspace'].includes(call[0]!)), [['doctor']]);
      } finally { await b.close(); }
    });
    // @feature docs/feature/herdr-mod/ui.md#刷新时不闪
    await t.test('uninitialized status keeps its button through repeated background reads and discovers terminal initialization', async () => {
      for (const namedError of [false, true]) {
        host = new Boundary();
        const b = host;
        b.files.delete('/repo/docs/taste.md');
        if (namedError) b.commandError = { code: 1, stdout: '', stderr: JSON.stringify({ error: 'ProjectNotInitialized', message: 'This repository has not been initialized' }) };
        const view = new Mod(); b.view = view; view.init(undefined, b.context()); b.draw();
        try {
          await b.until(() => b.output.find('initialize') !== undefined);
          for (let retry = 0; retry < 3; retry++) {
            const frame = b.frames.length, request = b.requests.length, timers = b.timers.length;
            const gate = b.commandGate = pending<void>();
            b.fire(2000);
            await b.until(() => b.requests.length > request);
            assert.ok(b.output.find('initialize'), 'the button remains while a command is pending');
            gate.resolve(); b.commandGate = undefined;
            await b.until(() => b.timers.length > timers);
            for (const rendered of b.frames.slice(frame)) {
              assert.ok(rendered.find('initialize'), 'background reads preserve the initialization button');
              assert.equal(rendered.find('concord-error'), undefined);
              assert.doesNotMatch(rendered.text(), /This repository has not been initialized|正在读取 Concord 仓库/u);
            }
          }
          b.commandError = undefined;
          b.files.set('/repo/docs/taste.md', '# Taste\n');
          b.fire(2000);
          await b.until(() => b.output.find(`page-${page}`) !== undefined);
          assert.equal(b.output.find('initialize'), undefined);
        } finally { b.commandGate?.resolve(); await b.close(); }
      }
    });
    // @use-case docs/feature/herdr-mod/use-case/follow-changes.md
    await t.test('workspace timeouts keep waiting, accepted changes refresh, and background tabs stop waiting', async () => {
      const b = await start(boundary => {
        boundary.props = { pane: 'mod-pane' };
        boundary.paneList.push({ pane: 'mod-pane', terminal: null, mod: 'concord', cwd: null, focused: false, tab: 't1' });
      });
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
      } finally { await b.close(); }
    });
    // @use-case docs/feature/herdr-mod/use-case/follow-changes.md
    await t.test('layout sidebar follows selected tabs and machines after an earlier CLI error', async () => {
      for (const machine of [null, 'vps']) {
        host = new Boundary();
        host.commandError = { code: 1, stdout: '', stderr: JSON.stringify({ error: 'ConfigurationInvalid', message: 'Previous repository error' }) };
        const view = new Mod(); host.view = view; view.init(undefined, host.context()); host.draw();
        try {
          await host.until(() => host.output.text().includes('Previous repository error'));
          host.commandError = undefined;
          const cwd = machine === null ? '/other' : '/repo';
          host.selectTab('t2', cwd, machine);
          // An uninitialized repository is read again every two seconds instead of waited on.
          await host.until(() => machine === null ? host.output.find('initialize') !== undefined : host.watches.some(watch => watch.root === cwd));
          assert.match(host.output.text(), machine === null ? /\/other/u : /vps:\/repo/u);
          assert.doesNotMatch(host.output.text(), /Previous repository error/u);
          assert.deepEqual(host.requests.filter(request => request.args[0] === '--version').at(-1)?.options, { cwd, on: machine });
          assert.equal(host.output.find(machine === null ? 'initialize' : `page-${page}`) !== undefined, true);
        } finally { await host.close(); }
      }
    });
    // @use-case docs/feature/herdr-mod/use-case/follow-changes.md
    await t.test('layout sidebar refreshes the same repository on tab changes and remembers each terminal', async () => {
      const b = await start();
      try {
        b.click(`page-${page}`); await b.until(() => b.output.find(`concord-body-${page}`) !== undefined);
        b.files.set(`/repo/${page}`, '# Changed while switching tabs\n');
        b.selectTab('t2', '/repo');
        await b.until(() => b.output.text().includes('# Changed while switching tabs'));
        const oldWatch = b.watches[0]!;
        b.paneList.push({ pane: 'other-terminal', terminal: 'other-terminal', tab: 't2', focused: true, cwd: '/other' });
        b.paneList.find(pane => pane.pane === 'pane-t2')!.focused = false; b.draw();
        await b.until(() => b.output.find('initialize') !== undefined);
        b.selectTab('t1', '/repo');
        await b.until(() => b.output.find(`page-${page}`) !== undefined);
        b.selectTab('t2', '/repo');
        await b.until(() => b.output.find('initialize') !== undefined);
        assert.match(b.output.text(), /\/other/u);
        const calls = b.calls.length;
        oldWatch.result.resolve({ code: 0, stdout: JSON.stringify({ operation: 'workspace-wait', changed: true, sourceDigest: 'late' }), stderr: '' });
        await new Promise<void>(resolve => setImmediate(resolve));
        assert.equal(b.calls.length, calls, 'a previous repository watch cannot refresh the selected repository');
        assert.match(b.output.text(), /\/other/u);
      } finally { await b.close(); }
    });
    // @use-case docs/feature/herdr-mod/use-case/follow-changes.md
    await t.test('layout sidebar ignores delayed root resolution from an earlier tab', async () => {
      const b = await start();
      const entered = pending<void>(), release = pending<void>();
      try {
        b.beforeRoot = async cwd => { if (cwd === '/other') { entered.resolve(); await release.promise; } };
        b.selectTab('t2', '/other');
        await b.until(() => b.requests.some(request => request.command === 'git' && request.options?.cwd === '/other'));
        await entered.promise;
        b.selectTab('t3', '/repo', 'vps');
        await b.until(() => b.output.text().includes('vps:/repo') && b.output.find(`page-${page}`) !== undefined);
        release.resolve(); await new Promise<void>(resolve => setImmediate(resolve));
        assert.match(b.output.text(), /vps:\/repo/u);
        assert.equal(b.output.find('initialize'), undefined);
      } finally { release.resolve(); await b.close(); }
    });
    await t.test('unavailable service falls back every two seconds and closes retained resources', async () => {
      const b = await start();
      b.watches[0]!.result.resolve({ code: 1, stdout: '', stderr: JSON.stringify({ error: 'HawdbUnavailable', message: 'Native unavailable' }) });
      await b.until(() => b.timers.some(timer => !timer.repeat && timer.ms === 2000));
      const before = b.calls.length; b.fire(2000);
      await b.until(() => b.calls.length > before && b.watches.length === 2);
      await b.close();
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
      const markdown = b.output.find(`concord-block-${page}-0`)!;
      assert.ok(markdown.link); markdown.link('https://example.com/outside.md', b.context());
      b.click('edit'); b.draw();
      const editor = b.output.find('document-editor')!.state!;
      editor.set_value('# Draft\n');
      b.click('discard');
      await b.until(() => b.output.find(`concord-body-${page}`) !== undefined);
      assert.equal(editor.released, true);
      await b.close();
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
      assert.equal(host.calls.length, 0); await host.close();
    });
    await t.test('live pane cwd supplies missing focused cwd', async () => {
      const b = await start(boundary => { boundary.cwd = null; });
      assert.match(b.output.text(), /Cart/u); await b.close();
    });
    await t.test('explicit overlay opens a right pane once or focuses its existing copy', async () => {
      for (const existing of [false, true]) {
      host = new Boundary();
        if (existing) host.paneList.push({ pane: 'p2', terminal: null, mod: 'concord', cwd: null, focused: false, tab: 't1' });
        host.props = { overlay: 'mod-concord' };
        const view = new Mod(); host.view = view; view.init(undefined, host.context());
        assert.deepEqual(host.commands, existing ? [{ name: 'pane.focus', args: { pane: 'p2' } }] : [
          { name: 'pane.split', args: { pane: 'p1', direction: 'right', mod: 'concord', props: {} } },
        ]);
        assert.deepEqual(host.closedOverlays, ['mod-concord']);
        assert.equal(host.calls.length, 0); await host.close();
      }
    });
    await t.test('missing CLI gates repository actions and can be detected after installation', async () => {
      host = new Boundary(); host.installedVersion = undefined;
      const view = new Mod(); host.view = view; view.init(undefined, host.context()); host.draw();
      await host.until(() => host.output.text().includes('curl -fsSL'));
      assert.equal(host.output.find('concord-tree'), undefined); assert.equal(host.calls.length, 0);
      host.click('copy-cli'); assert.match(host.clipboard, /^在本机安装 Concord 命令行工具：运行\ncurl -fsSL .*\n然后用 concord --version 确认能运行。$/u);
      // Detection repeats every two seconds without leaving the page, so the agent's install is picked up.
      host.fire(2000); await new Promise<void>(resolve => setImmediate(resolve));
      assert.match(host.output.text(), /这个 mod 需要 Concord 命令行工具/u);
      host.installedVersion = 'dev'; host.fire(2000);
      await host.until(() => host.watches.length === 1);
      assert.ok(host.output.find('concord-tree')); await host.close();
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
      host.reachable = false; host.colors = { foreground: '#123456' }; host.draw();
      await host.until(() => host.output.text().includes('连不上 vps'));
      assert.doesNotMatch(host.output.text(), /private diagnostic/u);
      await host.close();
    });
    // @use-case docs/feature/herdr-mod/use-case/init-from-herdr.md
    await t.test('live cwd follows the most recent terminal in its own tab, retaining same-root state', async () => {
      const b = await start(boundary => { boundary.props = { pane: 'mod-pane' }; });
      b.paneList.push({ pane: 'mod-pane', terminal: null, mod: 'concord', cwd: null, focused: false, tab: 't1' });
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
        assert.ok(b.watches.every(watch => watch.root === '/repo'), 'an uninitialized repository is read again, not waited on');
        b.paneList.find(pane => pane.pane === 'p2')!.focused = false;
        b.paneList.push({ pane: 'p3', terminal: 't3', tab: 't2', focused: true, cwd: '/repo' });
        b.focusedTab = 't2'; b.draw();
        assert.match(b.output.text(), /\/other/u, 'another tab cannot redirect this mod');
        b.paneList.find(pane => pane.pane === 'p2')!.cwd = '/repo'; b.draw();
        await b.until(() => b.output.find(`page-${page}`) !== undefined);
        assert.match(b.output.text(), /\/repo/u, 'mod focus preserves the most recently focused terminal');
      } finally { await b.close(); }
    });
    // @use-case docs/feature/herdr-mod/use-case/follow-changes.md
    await t.test('layout sidebar retains drafts through tab switches and uses the latest destination', async () => {
      for (const action of ['save', 'discard']) {
        const b = await start();
        try {
          b.click(`page-${page}`); await b.until(() => b.output.find(`concord-body-${page}`) !== undefined);
          b.click('edit'); const editor = b.output.find('document-editor')!.state!;
          editor.set_value('# Draft in original repository\n');
          b.selectTab('t2', '/other');
          await b.until(() => b.output.text().includes('终端已切到 /other，保存或放弃修改后切换'));
          b.selectTab('t3', '/other', 'vps');
          await b.until(() => b.output.text().includes('终端已切到 vps:/other，保存或放弃修改后切换'));
          assert.equal(b.output.find('document-editor')!.state, editor);
          b.click(action);
          await b.until(() => b.output.find('initialize') !== undefined);
          assert.match(b.output.text(), /vps:\/other/u);
          assert.equal(b.files.get(`/repo/${page}`), action === 'save' ? '# Draft in original repository\n' : '# Cart\n');
          const writes = b.requests.filter(request => request.args.some(arg => arg.includes('document.set')));
          assert.deepEqual(writes.map(request => request.options), action === 'save' ? [{ cwd: '/repo', on: null }] : []);
        } finally { await b.close(); }
      }
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
        } finally { await b.close(); }
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
      } finally { await b.close(); }
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
        assert.match(host.output.text(), /在 vps 上安装 Concord 命令行工具/u);
        host.installedVersion = 'dev'; host.fire(2000);
        await host.until(() => host.output.find(`page-${page}`) !== undefined);
        assert.ok(host.requests.every(request => request.options?.on === 'vps'));
      } finally { await host.close(); }
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
          host.click('copy-error');
          assert.match(host.clipboard, named ? /^Concord 在 \/repo 报错：ConfigurationInvalid：配置需要修正。/u : /原始输出：\nraw private process output$/u);
          if (!named) assert.match(host.output.text(), /复制时附上原始输出（1 行）/u);
        } finally { await host.close(); }
      }
    });
  } finally { plugin.clearAll(); delete global.__concordHostSync; }
});
