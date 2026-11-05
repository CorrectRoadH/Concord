// @concord-file
// @concord-implements docs/feature/herdr-mod/architecture.md
// Only the external Herdr/GPUI boundary is replaced; this loads the source mod
// and executes the public CLI. It does not measure native drawing.
import { execFile } from 'node:child_process';
import { registerHooks } from 'node:module';
import { watch } from 'node:fs';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Effect, Schema } from 'effect';

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
  on_click(callback: Callback) { this.click = callback; return this; }
  on_link_click(_callback: (url: string, cx: HostContext) => void) { return this; }
  text(): string { return this.nodes.map(node => typeof node === 'string' ? node : node.text()).join('\n'); }
  find(id: string): HostElement | undefined { return this.key === id ? this : this.nodes.flatMap(node => typeof node === 'string' ? [] : node.find(id) ?? []).at(0); }
}
interface HostTask { cancel(): void; is_done(): boolean }
interface HostContext { notify(): void; spawn(callback: (cx: HostContext) => unknown): HostTask; timer: { after(ms: number, callback: (cx: HostContext) => void): HostTask } }
interface ModView { init(props: undefined, cx: HostContext): void; render(cx: HostContext): HostElement; close(cx: HostContext): void }
class HostState {
  constructor(private text: string) {}
  value() { return this.text; } set_value(value: string) { this.text = value; } release() { return true; }
}
class HostFailure extends Schema.TaggedError<HostFailure>()('HostFailure', { message: Schema.String }) {}
const main = Effect.tryPromise({ try: async () => {
  const [entry, root, mode] = process.argv.slice(2);
  if (!entry || !root || !['first-screen', 'push', 'workflow'].includes(mode ?? '')) throw new Error('Expected installed CLI, consumer root, and first-screen|push|workflow');
  let closed = false, output: HostElement | undefined, view: ModView | undefined;
  const errors: unknown[] = [], tasks = new Set<HostTask>(), disposers: (() => void)[] = [];
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
      const timer = setTimeout(() => { done = true; if (!closed) callback(context()); }, ms);
      const task = { cancel() { clearTimeout(timer); done = true; }, is_done: () => done };
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
    exec: async (command: string, args: string[], options: { cwd: string }) => {
      if (command !== 'concord') throw new Error(`Unexpected product command ${command}`);
      calls.push(args.slice(args.indexOf('--root') + 2));
      const started = performance.now();
      const reply = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => execFile(process.execPath, [entry, ...args], { cwd: options.cwd, encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') reject(error);
        else resolve({ code: typeof error?.code === 'number' ? error.code : 0, stdout, stderr });
      }));
      timings.push({ operation: args.slice(args.indexOf('--root') + 2).join(' '), ms: performance.now() - started });
      return reply;
    },
    readTextFile: async (path: string) => readFile(path, 'utf8').catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }),
    writeTextFile: async (path: string, text: string, expected: string | null) => {
      if (await host.readTextFile(path) !== expected) throw new Error('File changed');
      const temporary = `${path}.herdr-host-tmp`; await writeFile(temporary, text); await rename(temporary, path); return null;
    },
    watchFolder: async (path: string): Promise<string[]> => {
      let state = fileWatchers.get(path);
      if (!state) {
        state = { pending: [], resolve: undefined }; fileWatchers.set(path, state);
        const watched = state;
        const watcher = watch(path, { recursive: true }, (_type, filename) => {
          if (filename) watched.pending.push(join(path, String(filename)));
          if (watched.resolve) { const resolve = watched.resolve; watched.resolve = undefined; const paths = watched.pending.splice(0); resolve(paths); }
        });
        disposers.push(() => watcher.close());
      }
      if (state.pending.length) return state.pending.splice(0);
      return await new Promise(resolve => { state.resolve = resolve; });
    },
  };
  const global = globalThis as typeof globalThis & { __concordHerdrBoundary?: typeof host };
  global.__concordHerdrBoundary = host;
  const exports: Record<string, readonly string[]> = { 'gpui-kit': ['View', 'div'], 'gpui-base': ['h_flex', 'v_flex', 'TextView', 'Editor', 'EditorState', 'Input', 'InputState'], herdr: ['exec', 'readTextFile', 'writeTextFile', 'watchFolder', 'pickFolder', 'focused', 'theme'] };
  const hooks = registerHooks({
    resolve(specifier, context, next) { return exports[specifier] ? { url: `concord-host:${specifier}`, shortCircuit: true } : next(specifier, context); },
    load(url, context, next) {
      const names = exports[url.replace('concord-host:', '')];
      return names ? { format: 'module', source: names.map(name => `export const ${name} = globalThis.__concordHerdrBoundary.${name};`).join('\n'), shortCircuit: true } : next(url, context);
    },
  });
  const waitFor = async (predicate: () => boolean) => {
    const deadline = performance.now() + 30_000;
    while (!predicate()) {
      if (errors.length) throw errors[0];
      if (performance.now() > deadline) throw new Error(`Mod description timeout: ${output?.text().slice(0, 1000)}`);
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    return performance.now();
  };
  const sourcePath = join(root, 'docs/feature/measured/README.md');
  let original: string | undefined;
  try {
    let started = performance.now();
    const module = await import(new URL('../src/entry/herdr-mod/main.ts', import.meta.url).href) as { default: new() => ModView };
    timings.push({ operation: 'load source mod', ms: performance.now() - started });
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
      if (!(await readFile(sourcePath, 'utf8')).includes('SAVED_FROM_NATIVE_MOD')) throw new Error('Native save did not write its draft');
      click('edit'); output!.find('document-editor')!.state!.set_value('# MY_CONFLICTING_DRAFT\n');
      const disk = `${await readFile(sourcePath, 'utf8')}\nAGENT_CHANGE\n`;
      const temporary = `${sourcePath}.agent.tmp`; await writeFile(temporary, disk); await rename(temporary, sourcePath);
      click('save');
      await waitFor(() => output?.find('merge') !== undefined);
      if (output!.find('document-editor')!.state!.value() !== '# MY_CONFLICTING_DRAFT\n' || await readFile(sourcePath, 'utf8') !== disk) throw new Error('Conflict replaced the disk or draft');
      click('discard');
      await waitFor(() => output?.find(`concord-body-docs/feature/measured/README.md`)?.text().includes('AGENT_CHANGE') === true);
      process.stdout.write(JSON.stringify({ boundary: 'actual built mod and public CLI; external Herdr UI only', text: output?.text(), calls, workflow: 'initialized, created, edited, saved, checked, preserved conflict, discarded' }) + '\n');
      return;
    }
    let ended = await waitFor(() => output?.find('concord-tree')?.text().includes('measured') === true);
    if (mode === 'push') {
      // Wait for the actual mod's asynchronous watcher and selected source before editing.
      await waitFor(() => fileWatchers.size > 0);
      output!.find('page-docs/feature/measured/README.md')!.click!(undefined, context());
      await waitFor(() => output?.find('concord-body-docs/feature/measured/README.md') !== undefined);
      original = await readFile(sourcePath, 'utf8');
      const marker = `MOD_PUSH_${crypto.randomUUID()}`;
      const temporary = join(dirname(sourcePath), '.herdr-mod-benchmark.tmp');
      await writeFile(temporary, `${original}\n${marker}\n`); await rename(temporary, sourcePath);
      started = performance.now();
      ended = await waitFor(() => output?.find('concord-body-docs/feature/measured/README.md')?.text().includes(marker) === true);
    }
    process.stdout.write(JSON.stringify({ ms: ended - started, startedAtMs: started, endedAtMs: ended, boundary: 'readable-mod-description; external Herdr UI substituted; no native drawing', text: output?.text(), calls, timings }) + '\n');
  } finally {
    view?.close(context()); closed = true;
    for (const task of tasks) task.cancel();
    for (const dispose of disposers) dispose();
    if (original !== undefined) { const temporary = `${sourcePath}.restore.tmp`; await writeFile(temporary, original); await rename(temporary, sourcePath); }
    hooks.deregister(); delete global.__concordHerdrBoundary;
  }
}, catch: error => new HostFailure({ message: error instanceof Error ? error.message : String(error) }) });
main.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
