// @concord-file
// @concord-implements docs/feature/herdr-mod/architecture.md
// @concord-implements docs/engineering/build/architecture.md#脚本只写项目特有的规则
// Only the external Herdr/GPUI boundary is replaced; this loads the source mod
// and executes the public CLI. It does not measure native drawing.
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Duration, Effect, Fiber, FileSystem, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { installationResources, installationRootForBin } from '../src/base/installation/index.ts';

type Callback = (event: unknown, cx: HostContext) => void;
class HostElement {
  readonly nodes: (HostElement | string)[] = [];
  key = '';
  click: Callback | undefined;
  state: HostState | undefined;
  id(value: string) { this.key = value; return this; }
  child(value: HostElement | string) { this.nodes.push(value); return this; }
  children(value: readonly (HostElement | string)[]) { this.nodes.push(...value); return this; }
  size_full() { return this; } flex_1() { return this; } min_w(_v: number) { return this; } min_h(_v: number) { return this; }
  w(_v: number) { return this; } h(_v: number) { return this; } gap(_v: number) { return this; }
  p(_v: number) { return this; } px(_v: number) { return this; } py(_v: number) { return this; }
  bg(_v: string) { return this; } text_color(_v: string) { return this; } text_size(_v: number) { return this; }
  rounded(_v: number) { return this; } overflow_y_scroll() { return this; }
  items_stretch() { return this; } overflow_hidden() { return this; }
  on_click(callback: Callback) { this.click = callback; return this; }
  on_link_click(_callback: (url: string, cx: HostContext) => void) { return this; }
  text(): string { return this.nodes.map(node => typeof node === 'string' ? node : node.text()).join('\n'); }
  find(id: string): HostElement | undefined { return this.key === id ? this : this.nodes.flatMap(node => typeof node === 'string' ? [] : node.find(id) ?? []).at(0); }
}
interface HostTask { cancel(): void; is_done(): boolean }
interface HostContext { notify(): void; spawn(callback: (cx: HostContext) => unknown): HostTask; timer: { after(ms: number, callback: (cx: HostContext) => void): HostTask } }
interface ModView { init(props: undefined, cx: HostContext): void; render(cx: HostContext): HostElement; close(cx: HostContext): void }
class HostState {
  private text: string;
  constructor(text: string) { this.text = text; }
  value() { return this.text; } set_value(value: string) { this.text = value; } release() { return true; }
}
class HostFailure extends Schema.TaggedError<HostFailure>()('HostFailure', { message: Schema.String }) {}
const main = Effect.scoped(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fibers = new Set<Fiber.Fiber<unknown, unknown>>();
  const scope = yield* Effect.scope;
  yield* Effect.addFinalizer(() => Effect.forEach(fibers, Fiber.interrupt, { concurrency: 'unbounded', discard: true }));
  return yield* Effect.tryPromise({ try: async signal => {
  const [entry, root, mode] = process.argv.slice(2);
  if (!entry || !root || !['first-screen', 'push', 'workflow'].includes(mode ?? '')) throw new Error('Expected installed CLI, consumer root, and first-screen|push|workflow');
  let closed = false, output: HostElement | undefined, view: ModView | undefined;
  const errors: unknown[] = [], tasks = new Set<HostTask>();
  const calls: string[][] = [];
  const timings: { operation: string; ms: number }[] = [];
  const context = (): HostContext => ({
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
    } },
  });
  const fileWatchers = new Map<string, { pending: string[]; resolve: ((paths: string[]) => void) | undefined }>();
  const host = {
    View: class {}, div: () => new HostElement(), h_flex: () => new HostElement(), v_flex: () => new HostElement(),
    TextView: { markdown: (id: string, text: string) => new HostElement().id(id).child(text) },
    EditorState: { new: (options: { value?: string }) => new HostState(options.value ?? '') },
    Editor: { new: (state: HostState) => { const element = new HostElement().child(state.value()); element.state = state; return element; } },
    InputState: { new: () => new HostState('') }, Input: { new: (state: HostState) => { const element = new HostElement().child(state.value()); element.state = state; return element; } },
    focused: () => ({ cwd: root, pane: 'external-boundary' }), theme: () => ({}), pickFolder: async () => root,
    panes: () => [], spaces: () => [], run: () => null, closeOverlay: () => null, appHome: () => '/external-herdr-home',
    props: () => ({}),
    exec: async (command: string, args: string[], options: { cwd: string } = { cwd: root }) => {
      if (command !== 'concord') throw new Error(`Unexpected product command ${command}`);
      const operation = args.includes('--root') ? args.slice(args.indexOf('--root') + 2) : args.filter(arg => arg !== '--json' && arg !== '--fresh');
      calls.push(operation);
      const started = performance.now();
      const execution = Effect.scoped(Effect.gen(function*() {
        const child = yield* spawner.spawn(ChildProcess.make(process.execPath, [entry, ...args], {
          cwd: options.cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
        }));
        const result = yield* Effect.all({ code: child.exitCode, stdout: Stream.mkString(Stream.decodeText(child.stdout)), stderr: Stream.mkString(Stream.decodeText(child.stderr)) }, { concurrency: 'unbounded' });
        return { ...result, code: Number(result.code) };
      }).pipe(Effect.timeout('30 seconds')));
      const fiber = Effect.runFork(execution.pipe(Effect.forkIn(scope)));
      const child = await Effect.runPromise(Fiber.join(fiber), { signal });
      fibers.add(child);
      const reply = await Effect.runPromise(Fiber.join(child), { signal });
      timings.push({ operation: operation.join(' '), ms: performance.now() - started });
      return reply;
    },
    readTextFile: (path: string) => path === '/external-herdr-home/mods/concord/mod.json' ? Promise.resolve(JSON.stringify({ minimumConcordVersion: 'dev' }))
      : Effect.runPromise(fs.readFileString(path).pipe(Effect.catch(error => error.reason._tag === 'NotFound' ? Effect.succeed(null) : Effect.fail(error)))),
    writeTextFile: async (path: string, text: string, expected: string | null) => {
      if (await host.readTextFile(path) !== expected) throw new Error('File changed');
      const temporary = `${path}.herdr-host-tmp`;
      await Effect.runPromise(fs.writeFileString(temporary, text).pipe(Effect.andThen(fs.rename(temporary, path))));
      return null;
    },
    watchFolder: async (path: string): Promise<string[]> => {
      let state = fileWatchers.get(path);
      if (!state) {
        state = { pending: [], resolve: undefined }; fileWatchers.set(path, state);
        const watched = state;
        const watcher = Effect.runFork(fs.watch(path, { recursive: true }).pipe(Stream.runForEach(event => Effect.sync(() => {
          watched.pending.push(join(path, event.path));
          if (watched.resolve) { const resolve = watched.resolve; watched.resolve = undefined; const paths = watched.pending.splice(0); resolve(paths); }
        })), Effect.catch(error => Effect.sync(() => { if (!closed) errors.push(error); }))));
        fibers.add(watcher);
      }
      if (state.pending.length) return state.pending.splice(0);
      return await new Promise(resolve => { state.resolve = resolve; });
    },
  };
  const global = globalThis as typeof globalThis & { __concordHerdrBoundary?: typeof host };
  global.__concordHerdrBoundary = host;
  const exports: Record<string, readonly string[]> = { 'gpui-kit': ['View', 'div'], 'gpui-base': ['h_flex', 'v_flex', 'TextView', 'Editor', 'EditorState', 'Input', 'InputState'], herdr: ['exec', 'readTextFile', 'writeTextFile', 'watchFolder', 'pickFolder', 'focused', 'panes', 'spaces', 'run', 'closeOverlay', 'appHome', 'props', 'theme'] };
  const hooks = registerHooks({
    resolve(specifier, context, next) { return exports[specifier] ? { url: `concord-host:${specifier}`, shortCircuit: true } : next(specifier, context); },
    load(url, context, next) {
      const names = exports[url.replace('concord-host:', '')];
      return names ? { format: 'module', source: names.map(name => `export const ${name} = globalThis.__concordHerdrBoundary.${name};`).join('\n'), shortCircuit: true } : next(url, context);
    },
  });
  const waitFor = (predicate: () => boolean) => Effect.runPromise(Effect.gen(function*() {
    while (!predicate()) {
      if (errors.length) return yield* Effect.fail(new HostFailure({ message: String(errors[0]) }));
      yield* Effect.sleep('5 millis');
    }
    return performance.now();
  }).pipe(Effect.timeoutOrElse({ duration: '30 seconds', orElse: () => Effect.fail(new HostFailure({ message: `Mod description timeout: ${output?.text().slice(0, 1000)}` })) })), { signal });
  const sourcePath = join(root, 'docs/feature/measured/README.md');
  let original: string | undefined;
  try {
    let started = performance.now();
    const mod = entry.endsWith('.ts') ? new URL('../src/entry/herdr-mod/main.ts', import.meta.url).href
      : pathToFileURL(join(installationResources(installationRootForBin(entry)).herdrMod, 'main.js')).href;
    const module = await import(mod) as { default: new() => ModView };
    timings.push({ operation: entry.endsWith('.ts') ? 'load source mod' : 'load packaged mod', ms: performance.now() - started });
    view = new module.default(); view.init(undefined, context()); output = view.render(context());
    if (mode === 'workflow') {
      await waitFor(() => fileWatchers.size > 0);
      const click = (id: string) => { const element = output?.find(id); if (!element?.click) throw new Error(`Missing UI action ${id}: ${output?.text()}`); element.click(undefined, context()); };
      click('initialize');
      await waitFor(() => output?.find('initialize') === undefined);
      click('new-feature');
      output!.find('feature-name')!.state!.set_value('measured'); output!.find('feature-title')!.state!.set_value('measured');
      click('create-feature'); await waitFor(() => output?.find('document-editor') !== undefined);
      const editor = output!.find('document-editor')!.state!;
      editor.set_value(`${editor.value()}\nSAVED_FROM_NATIVE_MOD\n`); click('save');
      await waitFor(() => output?.find('document-editor') === undefined && output?.text().includes('check:') === true);
      if (!(await Effect.runPromise(fs.readFileString(sourcePath))).includes('SAVED_FROM_NATIVE_MOD')) throw new Error('Native save did not write its draft');
      click('edit'); output!.find('document-editor')!.state!.set_value('# MY_CONFLICTING_DRAFT\n');
      const disk = `${await Effect.runPromise(fs.readFileString(sourcePath))}\nAGENT_CHANGE\n`;
      const temporary = `${sourcePath}.agent.tmp`;
      await Effect.runPromise(fs.writeFileString(temporary, disk).pipe(Effect.andThen(fs.rename(temporary, sourcePath))));
      click('save');
      await waitFor(() => output?.find('merge') !== undefined);
      if (output!.find('document-editor')!.state!.value() !== '# MY_CONFLICTING_DRAFT\n' || await Effect.runPromise(fs.readFileString(sourcePath)) !== disk) throw new Error('Conflict replaced the disk or draft');
      click('discard');
      await waitFor(() => output?.find(`concord-body-docs/feature/measured/README.md`)?.text().includes('AGENT_CHANGE') === true);
      process.stdout.write(JSON.stringify({ boundary: 'actual mod and public CLI; external Herdr UI only', text: output?.text(), calls, workflow: 'initialized, created, edited, saved, checked, preserved conflict, discarded' }) + '\n');
      return;
    }
    let ended = await waitFor(() => output?.find('concord-tree')?.text().includes('measured') === true);
    if (mode === 'push') {
      // Wait for the actual mod's asynchronous watcher and selected source before editing.
      await waitFor(() => fileWatchers.size > 0);
      output!.find('page-docs/feature/measured/README.md')!.click!(undefined, context());
      await waitFor(() => output?.find('concord-body-docs/feature/measured/README.md') !== undefined);
      original = await Effect.runPromise(fs.readFileString(sourcePath));
      const marker = `MOD_PUSH_${crypto.randomUUID()}`;
      const temporary = join(dirname(sourcePath), '.herdr-mod-benchmark.tmp');
      await Effect.runPromise(fs.writeFileString(temporary, `${original}\n${marker}\n`).pipe(Effect.andThen(fs.rename(temporary, sourcePath))));
      started = performance.now();
      ended = await waitFor(() => output?.find('concord-body-docs/feature/measured/README.md')?.text().includes(marker) === true);
    }
    process.stdout.write(JSON.stringify({ ms: ended - started, startedAtMs: started, endedAtMs: ended, boundary: 'readable-mod-description; external Herdr UI substituted; no native drawing', text: output?.text(), calls, timings }) + '\n');
  } finally {
    view?.close(context()); closed = true;
    for (const task of tasks) task.cancel();
    await Effect.runPromise(Effect.forEach(fibers, Fiber.interrupt, { concurrency: 'unbounded', discard: true }));
    if (original !== undefined) {
      const temporary = `${sourcePath}.restore.tmp`;
      await Effect.runPromise(fs.writeFileString(temporary, original).pipe(Effect.andThen(fs.rename(temporary, sourcePath))));
    }
    hooks.deregister(); delete global.__concordHerdrBoundary;
  }
}, catch: error => new HostFailure({ message: error instanceof Error ? error.message : String(error) }) });
}));
main.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
