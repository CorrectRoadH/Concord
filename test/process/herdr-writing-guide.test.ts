// 跨进程保证：外部程序——真实mod经宿主exec调用CLI初始化和读取指南，并在会话重开时连接工作区。
import assert from 'node:assert/strict';
import { execFile, execFileSync, type ChildProcess } from 'node:child_process';
import { plugin } from 'bun';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { installedConcordCli, pollUntil } from '../support/support.ts';
import { tmpdir } from '../support/temporary.ts';
import { stopWorkspaceServer } from '../support/stop-workspace-server.ts';
import { modManifest } from '../../src/model/herdr-mod/index.ts';

interface Task { cancel(): void; is_done(): boolean }
interface Context {
  notify(): void;
  stop_propagation(): void;
  open_url(url: string): void;
  write_to_clipboard(text: string): void;
  sleep(ms?: number): Promise<void>;
  spawn(body: (cx: Context) => unknown): Task;
  timer: { after(ms: number, body: (cx: Context) => void): Task; every(ms: number, body: (cx: Context) => void): Task };
}
class Element {
  key = '';
  nodes: (Element | string)[] = [];
  click: ((event: unknown, cx: Context) => void) | undefined;
  id(key: string) { this.key = key; return this; }
  child(node: Element | string) { this.nodes.push(node); return this; }
  children(nodes: (Element | string)[]) { this.nodes.push(...nodes); return this; }
  size_full() { return this; } flex_1() { return this; } min_w(_n: number) { return this; } min_h(_n: number) { return this; } items_stretch() { return this; }
  max_w(_n: number) { return this; } max_w_full() { return this; } items_center() { return this; } items_start() { return this; } justify_center() { return this; }
  w(_n: number) { return this; } gap(_n: number) { return this; } p(_n: number) { return this; } px(_n: number) { return this; } py(_n: number) { return this; }
  bg(_color: string) { return this; } text_color(_color: string) { return this; } text_size(_n: number) { return this; } rounded(_n: number) { return this; } overflow_y_scroll() { return this; } overflow_hidden() { return this; }
  h(_n: number) { return this; } size(_n: number) { return this; } flex_none() { return this; }
  pl(_n: number) { return this; } pr(_n: number) { return this; }
  border_1() { return this; } border_b(_n: number) { return this; } border_r(_n: number) { return this; } border_t(_n: number) { return this; } border_color(_color: string) { return this; }
  cursor_pointer() { return this; } truncate() { return this; } font_semibold() { return this; } font_family(_name: string) { return this; }
  hover(_body: (element: Element) => Element) { return this; }
  on_size_change(_body: (size: { width: number; height: number }, cx: Context) => void) { return this; }
  track_scroll(_handle: unknown) { return this; }
  on_click(body: (event: unknown, cx: Context) => void) { this.click = body; return this; }
  on_link_click(_body: unknown) { return this; }
  text(): string { return this.nodes.map(node => typeof node === 'string' ? node : node.text()).join('\n'); }
  find(key: string): Element | undefined { return this.key === key ? this : this.nodes.flatMap(node => typeof node === 'string' ? [] : node.find(key) ?? []).at(0); }
}
interface Mod { init(props: undefined, cx: Context): void; render(cx: Context): Element; close(cx: Context): Promise<void> }

// @use-case docs/feature/herdr-mod/use-case/init-from-herdr.md#guide
test('source mod initializes through the real CLI, reopens without the guide and navigates package directories', { timeout: 90_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-herdr-guide-'));
  const hostRoot = mkdtempSync(join(tmpdir(), 'concord-herdr-guide-host-'));
  const cli = installedConcordCli(), calls: string[][] = [], markdown: { id: string; source: string }[] = [];
  const tasks = new Set<Task>(), pending = new Set<Promise<unknown>>();
  const children = new Set<ChildProcess>(), sharedData = new Map<string, unknown>();
  const errors: unknown[] = [];
  let view: Mod | undefined, output: Element | undefined;
  const context: Context = {
    stop_propagation() {},
    open_url() {},
    write_to_clipboard() {},
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    notify() { output = view?.render(context); },
    spawn(body) {
      let done = false, cancelled = false;
      const task = { cancel() { cancelled = true; }, is_done: () => done || cancelled };
      tasks.add(task);
      const promise = Promise.resolve().then(() => cancelled ? undefined : body(context)).catch(cause => { errors.push(cause); }).finally(() => { done = true; pending.delete(promise); });
      pending.add(promise);
      return task;
    },
    timer: { after(ms, body) {
      let done = false;
      const timer = setTimeout(() => { done = true; body(context); }, ms);
      const task = { cancel() { clearTimeout(timer); done = true; }, is_done: () => done };
      tasks.add(task); return task;
    }, every(ms, body) {
      let done = false;
      const timer = setInterval(() => body(context), ms);
      const task = { cancel() { clearInterval(timer); done = true; }, is_done: () => done };
      tasks.add(task); return task;
    } },
  };
  const state = { new: () => ({ value: () => '', release() {} }) };
  // Substitute only the external Herdr/GPUI host; the built view, session and CLI are real.
  const host = {
    View: class {}, div: () => new Element(), image: (path: string) => new Element().child(path), svg: () => new Element(), h_flex: () => new Element(), v_flex: () => new Element(),
    v_virtual_list: (id: string, count: number, _height: number, _key: (index: number) => string, render: (range: { start: number; end: number }, cx: Context) => Element[]) => new Element().id(id).children(render({ start: 0, end: count }, context)),
    VirtualListScrollHandle: state,
    TextView: { markdown(id: string, source: string) { markdown.push({ id, source }); return new Element().id(id).child(source); } },
    EditorState: state, Editor: { new: () => new Element() },
    focused: () => ({ cwd: root, pane: 'p1', tab: 'tab1' }), theme: () => ({}), settings: () => ({ font_family: '' }),
    panes: () => [{ pane: 'p1', terminal: 't1', focused: true, tab: 'tab1', cwd: root }],
    spaces: () => [{ id: 's1', machine: null, active: true, tabs: [{ id: 'tab1', active: true }] }],
    props: () => ({}), appHome: () => hostRoot, home: () => '/home/host',
    shared: (key: string) => structuredClone(sharedData.get(key)),
    setShared: (key: string, value: unknown) => { sharedData.set(key, structuredClone(value)); return null; },
    run: () => { throw new Error('Guide workflow must not run host commands'); },
    closeOverlay: () => { throw new Error('Guide workflow must not close an overlay'); },
    exec: async (command: string, args: string[], options?: { cwd: string }) => {
      assert.ok(command === 'concord' || command === 'git');
      if (command === 'concord') calls.push(args);
      return await new Promise<{ code: number; stdout: string; stderr: string }>((resolveReply, reject) => {
        const child = execFile(command === 'concord' ? process.execPath : command, command === 'concord' ? [cli, ...args] : args, { cwd: options?.cwd, encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
          children.delete(child);
          if (error && typeof error.code !== 'number') reject(error);
          else resolveReply({ code: typeof error?.code === 'number' ? error.code : 0, stdout, stderr });
        });
        children.add(child);
      });
    },
  };
  const global = globalThis as typeof globalThis & { __concordGuideHost?: typeof host };
  global.__concordGuideHost = host;
  const exports: Record<string, string[]> = { 'gpui-kit': ['View', 'div', 'image', 'svg'], 'gpui-base': ['h_flex', 'v_flex', 'v_virtual_list', 'VirtualListScrollHandle', 'TextView', 'Editor', 'EditorState'], herdr: ['exec', 'focused', 'panes', 'spaces', 'run', 'closeOverlay', 'appHome', 'home', 'props', 'theme', 'settings', 'shared', 'setShared'] };
  plugin({ name: 'concord-test-herdr-host', setup(build) {
    for (const [specifier, members] of Object.entries(exports)) {
      build.module(specifier, () => ({ loader: 'object', exports: Object.fromEntries(members.map(name => [name, host[name as keyof typeof host]])) }));
    }
  } });
  const wait = (condition: () => boolean) => pollUntil(() => condition() ? Promise.resolve(true) : Promise.resolve(undefined), { timeoutMs: 45_000, description: 'source mod guide state' }).catch(cause => {
    throw new Error(`Source mod did not reach the expected state: ${output?.text()}\nCalls: ${JSON.stringify(calls)}\nHost errors: ${errors.map(String).join('\n')}`, { cause });
  });
  const close = async () => {
    await view?.close(context);
    for (const task of tasks) task.cancel();
    for (const child of children) child.kill();
    await Promise.allSettled([...pending]);
    tasks.clear();
  };
  try {
    mkdirSync(join(hostRoot, 'mods', 'concord'), { recursive: true });
    writeFileSync(join(hostRoot, 'mods', 'concord', 'mod.json'), JSON.stringify(modManifest('dev')));
    execFileSync('git', ['init', '-q', root]);
    const { default: BuiltMod } = await import(pathToFileURL(resolve('src/entry/herdr-mod/main.ts')).href) as { default: new() => Mod };
    view = new BuiltMod(); view.init(undefined, context); context.notify();
    await wait(() => output?.find('initialize') !== undefined);
    output!.find('initialize')!.click!(undefined, context);
    await wait(() => output?.find('read-guide') !== undefined);
    const files = execFileSync('git', ['-C', root, 'ls-files', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
    assert.match(output!.text(), new RegExp(`新建了 ${files.length} 个文件`, 'u'));
    assert.match(output!.text(), /下一步：让 agent 读写作指南\nconcord --skill docs-from-scratch/u);
    output!.find('read-guide')!.click!(undefined, context);
    await wait(() => output?.find('concord-writing-guide') !== undefined);
    const guide = readFileSync('skills/concord/references/docs-from-scratch.md', 'utf8');
    assert.equal(output!.find('concord-writing-guide')!.text().trimEnd(), guide.trimEnd());
    assert.ok(markdown.some(item => item.id === 'concord-writing-guide' && item.source.trimEnd() === guide.trimEnd()));
    assert.ok(calls.some(args => JSON.stringify(args) === JSON.stringify(['--skill', 'docs-from-scratch'])));
    assert.ok(calls.some(args => JSON.stringify(args) === JSON.stringify(['--version'])));
    await close();
    for (const kind of ['feature', 'engineering']) {
      execFileSync(process.execPath, [cli, '--root', root, 'new', kind, 'cart', '--title', `${kind} Cart`], { encoding: 'utf8' });
      const directory = join(root, `docs/${kind}/cart/architecture`);
      mkdirSync(directory);
      writeFileSync(join(directory, 'README.md'), `# ${kind} Cart architecture\n`);
      writeFileSync(join(directory, 'storage.md'), `# ${kind} Cart storage\n`);
    }
    writeFileSync(join(root, 'docs/feature/cart/unclassified.md'), '# Unclassified page\n');
    view = new BuiltMod(); view.init(undefined, context); context.notify();
    await wait(() => output?.find('category-项目规则') !== undefined);
    output!.find('category-项目规则')!.click!(undefined, context);
    await wait(() => output?.find('page-docs/taste.md') !== undefined);
    assert.equal(output!.find('initialize'), undefined);
    assert.equal(output!.find('read-guide'), undefined);
    assert.equal(output!.find('concord-writing-guide'), undefined);
    assert.doesNotMatch(output!.text(), /下一步：让 agent 读写作指南|新建了/u);
    const clickPage = async (path: string, source: string) => {
      const button = output!.find(`page-${path}`);
      assert.ok(button?.click, `Missing page action ${path}`);
      button.click(undefined, context);
      await wait(() => output?.find(`concord-body-${path}`)?.text() === source);
    };
    for (const kind of ['feature', 'engineering']) {
      const directory = `docs/${kind}/cart/architecture`;
      const rootPage = `docs/${kind}/cart/README.md`;
      output!.find(`page-${rootPage}`)!.click!(undefined, context);
      await wait(() => output?.find(`concord-body-${rootPage}`) !== undefined);
      const folder = output!.find(`tree-row-${directory}`);
      assert.ok(folder, 'kind directory is a navigation node');
      assert.equal(output!.find(`page-${directory}/storage.md`), undefined, 'kind directory starts folded');
      await clickPage(`${directory}/README.md`, `# ${kind} Cart architecture\n`);
      assert.ok(output!.find(`page-${directory}/storage.md`), 'the opened directory shows its leaf page');
      await clickPage(`${directory}/storage.md`, `# ${kind} Cart storage\n`);
    }
    await clickPage('docs/feature/cart/unclassified.md', '# Unclassified page\n');
    assert.deepEqual(errors, []);
  } finally {
    await close();
    plugin.clearAll(); delete global.__concordGuideHost;
    stopWorkspaceServer(root);
    rmSync(root, { recursive: true, force: true });
    rmSync(hostRoot, { recursive: true, force: true });
  }
});
