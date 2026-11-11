// @concord-file
// @concord-implements docs/feature/herdr-mod/architecture.md
import { packageCommand } from '../../scripts/package-command.ts';
// Only the external Herdr/GPUI boundary is replaced; this loads the source mod
// and executes the public CLI. It does not measure native drawing.
import { plugin } from 'bun';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Duration, Effect, Fiber, FileSystem, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { installationResources, installationRootForBin } from '../../src/base/installation/index.ts';

type Callback = (event: unknown, cx: HostContext) => void;
class HostElement {
  readonly nodes: (HostElement | string)[] = [];
  key = '';
  click: Callback | undefined;
  state: HostState | undefined;
  id(value: string) { this.key = value; return this; }
  child(value: HostElement | string) { this.nodes.push(value); return this; }
  children(value: readonly (HostElement | string)[]) { this.nodes.push(...value); return this; }
  relative() { return this; }
  size_full() { return this; } flex_1() { return this; } min_w(_v: number) { return this; } min_h(_v: number) { return this; }
  max_w(_v: number) { return this; } items_center() { return this; } items_start() { return this; } justify_center() { return this; }
  max_w_full() { return this; }
  w(_v: number) { return this; } h(_v: number) { return this; } gap(_v: number) { return this; }
  p(_v: number) { return this; } px(_v: number) { return this; } py(_v: number) { return this; }
  bg(_v: string) { return this; } text_color(_v: string) { return this; } text_size(_v: number) { return this; }
  rounded(_v: number) { return this; } overflow_y_scroll() { return this; }
  items_stretch() { return this; } overflow_hidden() { return this; }
  size(_v: number) { return this; } flex_none() { return this; }
  pl(_v: number) { return this; } pr(_v: number) { return this; }
  border_1() { return this; } border_b(_v: number) { return this; } border_r(_v: number) { return this; } border_t(_v: number) { return this; } border_color(_v: string) { return this; }
  cursor_pointer() { return this; } truncate() { return this; } font_semibold() { return this; } font_family(_v: string) { return this; }
  hover(_body: (element: HostElement) => HostElement) { return this; }
  on_size_change(_body: (size: { width: number; height: number }, cx: HostContext) => void) { return this; }
  track_scroll(_handle: HostState) { return this; }
  on_click(callback: Callback) { this.click = callback; return this; }
  on_mouse_down(_button: 'left' | 'right' | 'middle', _callback: Callback) { return this; }
  on_link_click(_callback: (url: string, cx: HostContext) => void) { return this; }
  text(): string { return this.nodes.map(node => typeof node === 'string' ? node : node.text()).join('\n'); }
  find(id: string): HostElement | undefined { return this.key === id ? this : this.nodes.flatMap(node => typeof node === 'string' ? [] : node.find(id) ?? []).at(0); }
}
interface HostTask { cancel(): void; is_done(): boolean }
interface HostContext { notify(): void; stop_propagation(): void; open_url(url: string): void; write_to_clipboard(text: string): void; sleep(ms?: number): Promise<void>; spawn(callback: (cx: HostContext) => unknown): HostTask; timer: { after(ms: number, callback: (cx: HostContext) => void): HostTask; every(ms: number, callback: (cx: HostContext) => void): HostTask } }
interface ModView { init(props: undefined, cx: HostContext): void; render(cx: HostContext): HostElement; close(cx: HostContext): void | Promise<void> }
class HostState {
  private text: string;
  private listeners = new Map<string, Callback>();
  constructor(text: string) { this.text = text; }
  value() { return this.text; } set_value(value: string) { this.text = value; } release() { return true; }
  on(event: string, callback: Callback) { this.listeners.set(event, callback); return true; }
  set_auto_grow(_min: number, _max: number) {}
  focus() {}
  input(value: string, cx: HostContext) { this.set_value(value); this.listeners.get('change')?.({}, cx); }
  blur(cx: HostContext) { this.listeners.get('blur')?.({}, cx); }
}
class HostFailure extends Schema.TaggedError<HostFailure>()('HostFailure', { message: Schema.String }) {}
const main = Effect.scoped(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fibers = new Set<Fiber.Fiber<unknown, unknown>>();
  const scope = yield* Effect.scope;
  const herdrHome = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-herdr-host-' });
  yield* Effect.addFinalizer(() => Effect.forEach(fibers, Fiber.interrupt, { concurrency: 'unbounded', discard: true }));
  return yield* Effect.tryPromise({ try: async signal => {
  const [entry, root, mode] = process.argv.slice(2);
  if (!entry || !root || !['first-screen', 'push', 'workflow'].includes(mode ?? '')) throw new Error('Expected installed CLI, consumer root, and first-screen|push|workflow');
  let clipboard = '';
  let closed = false, output: HostElement | undefined, view: ModView | undefined;
  const errors: unknown[] = [], tasks = new Set<HostTask>();
  const calls: string[][] = [];
  const context = (): HostContext => ({
    stop_propagation() {},
    open_url() {},
    write_to_clipboard(value) { clipboard = value; },
    sleep: ms => Effect.runPromise(Effect.sleep(Duration.millis(ms ?? 0))),
    notify() { if (closed) throw new Error('Closed mod context'); output = view?.render(context()); },
    spawn(callback) {
      let cancelled = false, done = false;
      const task = { cancel() { cancelled = true; }, is_done: () => done || cancelled };
      tasks.add(task);
      Promise.resolve().then(() => cancelled ? undefined : callback({ ...context(), notify() { if (cancelled || closed) throw new Error('Expired task context'); output = view?.render(context()); } })).catch(error => { if (!cancelled && !closed) errors.push(error); }).finally(() => { done = true; });
      return task;
    },
    timer: { after(ms, callback) {
      let done = false;
      const timer = Effect.runFork(Effect.sleep(Duration.millis(ms)).pipe(Effect.andThen(Effect.sync(() => { done = true; if (!closed) callback(context()); }))));
      fibers.add(timer);
      const task = { cancel() { timer.interruptUnsafe(); done = true; }, is_done: () => done };
      tasks.add(task); return task;
    }, every(ms, callback) {
      const timer = Effect.runFork(Effect.forever(Effect.sleep(Duration.millis(ms)).pipe(Effect.andThen(Effect.sync(() => { if (!closed) callback(context()); })))));
      fibers.add(timer);
      let cancelled = false;
      const task = { cancel() { timer.interruptUnsafe(); cancelled = true; }, is_done: () => cancelled };
      tasks.add(task); return task;
    } },
  });
  const sharedData = new Map<string, unknown>();
  const host = {
    View: class {}, div: () => new HostElement(), image: (path: string) => new HostElement().child(path), svg: () => new HostElement(), h_flex: () => new HostElement(), v_flex: () => new HostElement(),
    v_virtual_list: (id: string, count: number, _height: number, _key: (index: number) => string, render: (range: { start: number; end: number }, cx: HostContext) => HostElement[]) => new HostElement().id(id).children(render({ start: 0, end: count }, context())),
    VirtualListScrollHandle: { new: () => new HostState('') },
    TextView: { markdown: (id: string, text: string) => new HostElement().id(id).child(text) },
    EditorState: { new: (options: { value?: string }) => new HostState(options.value ?? '') },
    Editor: { new: (state: HostState) => { const element = new HostElement().child(state.value()); element.state = state; return element; } },
    TextareaState: { new: (options: { value?: string }) => new HostState(options.value ?? '') },
    Textarea: { new: (state: HostState) => { const element = new HostElement().child(state.value()); element.state = state; return element; } },
    focused: () => ({ cwd: root, pane: 'pane-host-tab', tab: 'host-tab' }), theme: () => ({}), settings: () => ({ font_family: '' }),
    panes: () => [{ pane: 'pane-host-tab', terminal: 'host-terminal', tab: 'host-tab', focused: true, cwd: root }],
    spaces: () => [{ id: 'host-space', machine: null, tabs: [{ id: 'host-tab', active: true }] }],
    run: () => null, closeOverlay: () => null, appHome: () => herdrHome, home: () => '/external-home',
    props: () => ({}),
    shared: (key: string) => structuredClone(sharedData.get(key)),
    setShared: (key: string, value: unknown) => { sharedData.set(key, structuredClone(value)); return null; },
    exec: async (command: string, args: string[], options: { cwd: string } = { cwd: root }) => {
      if (!['concord', 'git'].includes(command)) throw new Error(`Unexpected product command ${command}`);
      const operation = args.includes('--root') ? args.slice(args.indexOf('--root') + 2) : args.filter(arg => arg !== '--json' && arg !== '--fresh');
      calls.push(operation);
      const execution = Effect.scoped(Effect.gen(function*() {
        const argv = command === 'concord' ? [...packageCommand(entry), ...args] : [command, ...args];
        const child = yield* spawner.spawn(ChildProcess.make(argv[0]!, argv.slice(1), {
          cwd: options.cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
        }));
        const result = yield* Effect.all({ code: child.exitCode, stdout: Stream.mkString(Stream.decodeText(child.stdout)), stderr: Stream.mkString(Stream.decodeText(child.stderr)) }, { concurrency: 'unbounded' });
        return { ...result, code: Number(result.code) };
      }).pipe(Effect.timeout('30 seconds')));
      const fiber = Effect.runFork(execution.pipe(Effect.forkIn(scope)));
      const child = await Effect.runPromise(Fiber.join(fiber), { signal });
      fibers.add(child);
      const reply = await Effect.runPromise(Fiber.join(child), { signal });
      return reply;
    },
  };
  const exports: Record<string, readonly (keyof typeof host)[]> = { 'gpui-kit': ['View', 'div', 'image', 'svg'], 'gpui-base': ['h_flex', 'v_flex', 'v_virtual_list', 'VirtualListScrollHandle', 'TextView', 'Editor', 'EditorState', 'Textarea', 'TextareaState'], herdr: ['exec', 'shared', 'setShared', 'focused', 'panes', 'spaces', 'run', 'closeOverlay', 'appHome', 'home', 'props', 'theme', 'settings'] };
  plugin({ name: 'concord-herdr-host', setup(builder) {
    for (const [specifier, names] of Object.entries(exports)) {
      builder.module(specifier, () => ({ loader: 'object', exports: Object.fromEntries(names.map(name => [name, host[name]])) }));
    }
  } });
  const waitFor = (predicate: () => boolean) => Effect.runPromise(Effect.gen(function*() {
    while (!predicate()) {
      if (errors.length) return yield* Effect.fail(new HostFailure({ message: String(errors[0]) }));
      yield* Effect.sleep('5 millis');
    }
  }).pipe(Effect.timeoutOrElse({ duration: '30 seconds', orElse: () => Effect.fail(new HostFailure({ message: `Mod description timeout: ${output?.text().slice(0, 1000)}` })) })), { signal });
  const documentPath = mode === 'workflow' ? 'docs/taste.md' : 'docs/feature/measured/README.md';
  const sourcePath = join(root, documentPath);
  let original: string | undefined;
  try {
    const mod = entry.endsWith('.ts') ? new URL('../../src/entry/herdr-mod/main.ts', import.meta.url).href
      : pathToFileURL(join(installationResources(installationRootForBin(entry)).herdrMod, 'main.js')).href;
    const module = await import(mod) as { default: new() => ModView };
    view = new module.default(); view.init(undefined, context()); output = view.render(context());
    if (mode === 'workflow') {
      // An uninitialized repository is read again on a timer, not waited on.
      await waitFor(() => output?.find('initialize') !== undefined);
      const click = (id: string) => { const element = output?.find(id); if (!element?.click) throw new Error(`Missing UI action ${id}: ${output?.text()}`); element.click(undefined, context()); };
      click('initialize');
      await waitFor(() => output?.find('category-项目规则') !== undefined);
      click('copy-initialization');
      if (!clipboard.includes(`${root} 刚初始化了 Concord。`) || !clipboard.includes('concord --skill start') || output?.find('read-guide') || output?.find('concord-writing-guide')) throw new Error('Initialization handoff is missing or renders the guide');
      click('category-项目规则'); click(`page-${documentPath}`);
      await waitFor(() => output?.find(`concord-body-${documentPath}`) !== undefined);
      click('preview-block-0');
      const editor = output!.find('document-editor')!.state!;
      editor.input(`${editor.value()}\n\nSAVED_FROM_NATIVE_MOD`, context()); editor.blur(context());
      await waitFor(() => output?.find('document-editor') === undefined && (output?.text().includes('已保存') === true || output?.find('concord-check') !== undefined));
      if (!(await Effect.runPromise(fs.readFileString(sourcePath))).includes('SAVED_FROM_NATIVE_MOD')) throw new Error('Native save did not write its draft');
      click('preview-block-0');
      const disk = `${await Effect.runPromise(fs.readFileString(sourcePath))}\nAGENT_CHANGE\n`;
      const temporary = `${sourcePath}.agent.tmp`;
      await Effect.runPromise(fs.writeFileString(temporary, disk).pipe(Effect.andThen(fs.rename(temporary, sourcePath))));
      await waitFor(() => output?.find(`concord-body-${documentPath}`)?.text().includes('AGENT_CHANGE') === true);
      if (output?.find('document-editor') || await Effect.runPromise(fs.readFileString(sourcePath)) !== disk) throw new Error('External reload did not replace the editor');
      process.stdout.write(JSON.stringify({ boundary: 'actual mod and public CLI; external Herdr UI only', text: output?.text(), calls, workflow: 'initialized, edited in place, autosaved, checked, reloaded external update' }) + '\n');
      return;
    }
    await waitFor(() => output?.find('concord-tree')?.text().includes('measured') === true);
    if (mode === 'push') {
      // Wait for the actual mod's asynchronous watcher and selected source before editing.
      await waitFor(() => calls.some(call => call[0] === 'workspace' && call[1] === 'wait'));
      output!.find('page-docs/feature/measured/README.md')!.click!(undefined, context());
      await waitFor(() => output?.find('concord-body-docs/feature/measured/README.md') !== undefined);
      original = await Effect.runPromise(fs.readFileString(sourcePath));
      const marker = `MOD_PUSH_${crypto.randomUUID()}`;
      const temporary = join(dirname(sourcePath), '.herdr-mod-update.tmp');
      await Effect.runPromise(fs.writeFileString(temporary, `${original}\n${marker}\n`).pipe(Effect.andThen(fs.rename(temporary, sourcePath))));
      await waitFor(() => output?.find('concord-body-docs/feature/measured/README.md')?.text().includes(marker) === true);
    }
    process.stdout.write(JSON.stringify({ boundary: 'readable-mod-description; external Herdr UI substituted; no native drawing', text: output?.text(), calls }) + '\n');
  } finally {
    await view?.close(context()); closed = true;
    for (const task of tasks) task.cancel();
    await Effect.runPromise(Effect.forEach(fibers, Fiber.interrupt, { concurrency: 'unbounded', discard: true }));
    if (original !== undefined) {
      const temporary = `${sourcePath}.restore.tmp`;
      await Effect.runPromise(fs.writeFileString(temporary, original).pipe(Effect.andThen(fs.rename(temporary, sourcePath))));
    }
    plugin.clearAll();
  }
}, catch: error => new HostFailure({ message: error instanceof Error ? error.message : String(error) }) });
}));
main.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
