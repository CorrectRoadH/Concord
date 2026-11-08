// @concord-file
// @concord-implements docs/feature/herdr-mod/README.md
// @concord-implements docs/feature/herdr-mod/use-case/read-spec.md#open-feature
// @concord-implements docs/feature/herdr-mod/use-case/edit-and-check.md
// @concord-implements docs/feature/herdr-mod/use-case/follow-changes.md
// @concord-implements docs/feature/herdr-mod/use-case/use-on-remote-machine.md
// @concord-implements docs/feature/herdr-mod/ui.md
import { Effect, Scheduler, Schema } from 'effect';
import { View, div, type AsyncContext, type Context, type Element, type Task } from 'gpui-kit';
import { h_flex, v_flex, TextView, Editor, EditorState } from 'gpui-base';
import { exec, focused, panes, spaces, run, closeOverlay, home, props as hostProps, theme, settings } from 'herdr';
import { ModSession, ModFailure, ModDisconnected, failure, markdownTarget } from './session.ts';
import { ModVersion, compareModVersions, type RenderedPage } from '../../model/herdr-mod/index.ts';
import { RenderAssets, type RenderLease } from './render-assets.ts';
import { codeMarkdown, renderedPageElements } from './rendered-page.ts';
import { clickableRow, color, heading, icon, mono, row, text, type IconName } from './ui.ts';
declare const CONCORD_MOD_MINIMUM_VERSION: string;

const runEffect = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect, { scheduler: new Scheduler.MixedScheduler('sync') });
const installCommand = 'curl -fsSL https://github.com/CorrectRoadH/Concord/releases/latest/download/install.sh | sh';
type Target = { cwd: string; machine: string | null };
const documentGroups = ['Feature', 'Engineering', 'Roadmap', '项目规则', 'Design', 'Issue', 'Memory', '其它文档'] as const;
type DocumentGroup = typeof documentGroups[number];

export default class ConcordMod extends View {
  private session = new ModSession({ exec }, '');
  private tasks = new Set<Task>();
  private watcher: Task | undefined;
  private polling: Task | undefined;
  private watchedRoot: string | undefined;
  private editor: EditorState | undefined;
  private preview: EditorState | undefined;
  private previewLabel = '';
  private conceptText: string | undefined;
  private cli: 'checking' | 'missing' | 'outdated' | 'ready' = 'checking';
  private cliVersion = '';
  private minimumVersion = Schema.decodeUnknownSync(ModVersion)(typeof CONCORD_MOD_MINIMUM_VERSION === 'undefined' ? 'dev' : CONCORD_MOD_MINIMUM_VERSION);
  private newerCli = false;
  private tab: string | undefined;
  private terminals = new Map<string, string>();
  private ownPane: string | undefined;
  private observedTarget = '';
  private navigation: Task | undefined;
  private retry: Task | undefined;
  private targetToken = {};
  private pendingSwitch: Target | undefined;
  private directory: 'no-terminal' | 'resolving' | 'not-git' | 'repository' = 'no-terminal';
  private target: Target | undefined;
  private disconnected = false;
  private remoteHome = '';
  private watchToken = {};
  private foreground = true;
  private refreshing = false;
  private refreshQueued = false;
  private copied = '';
  private rechecking = false;
  private copiedReset: Task | undefined;
  private closed = false;
  private assets = new RenderAssets();
  private pageLease: RenderLease | undefined;
  private renderedPage: RenderedPage | undefined;
  private renderTasks = new Set<Task>();
  private renderToken = {};
  private renderKey = '';
  private renderedPath = '';
  private expandedBlocks = new Set<number>();
  private expanded = new Set<string>();
  private collapsedGroups = new Set<string>(documentGroups.filter(name => name !== 'Feature' && name !== 'Engineering'));
  private panelWidth = 480;
  private treeHidden = false;
  private busy = new Map<string, string>();

  init(initialProps: Readonly<Record<string, unknown>> | undefined, cx: AsyncContext): void {
    const props = { ...hostProps(), ...initialProps };
    const focus = focused();
    const allPanes = panes();
    const pane = allPanes.find(item => item.pane === focus?.pane) ?? allPanes.find(item => item.focused);
    // mod.open is an overlay on the host; its explicit command opens our right pane.
    if (typeof props?.overlay === 'string') {
      const existing = allPanes.find(item => item.mod === 'concord' && item.tab === focus?.tab);
      if (existing || pane) {
        if (existing) run('pane.focus', { pane: existing.pane });
        else run('pane.split', { pane: pane!.pane, direction: 'right', mod: 'concord', props: {} });
        closeOverlay(props.overlay);
        return;
      }
    }
    this.assets.start(cx);
    this.ownPane = typeof props.pane === 'string' ? props.pane : undefined;
    this.tab = allPanes.find(item => item.pane === this.ownPane)?.tab ?? focus?.tab ?? spaces().find(item => item.active)?.tabs.find(item => item.active)?.id;
    this.retry = cx.timer.every(2000, current => {
      if (this.closed || !this.foreground) return;
      if (this.disconnected) { this.observedTarget = ''; this.followTerminal(current); }
      else if (this.cli === 'missing' || this.cli === 'outdated') this.recheckCli(current);
    });
    this.followTerminal(cx);
  }

  /** While the agent installs or upgrades Concord, detect it again without leaving the current page. */
  private recheckCli(cx: Context): void {
    if (this.rechecking || !this.session.root) return;
    const session = this.session, token = this.targetToken;
    this.rechecking = true;
    cx.spawn(async next => {
      try {
        await this.detectCli({ cwd: session.root, machine: session.machine }, () => !this.closed && session === this.session && token === this.targetToken, true);
        if (this.cli === 'ready' && session === this.session) { this.refresh(next); next.notify(); }
      } catch { /* The next tick tries again. */ }
      finally { this.rechecking = false; }
    });
  }

  private async detectCli(target: Target, current: () => boolean, quiet = false): Promise<void> {
    if (!quiet) { this.cli = 'checking'; this.session.error = ''; }
    let reply;
    try { reply = await exec('concord', ['--version'], { cwd: target.cwd, on: target.machine }); }
    catch {
      // A successful Git probe distinguishes an absent executable from a lost machine.
      if (target.machine !== null) await this.resolveRoot(target);
      if (current()) this.cli = 'missing';
      return;
    }
    if (!current()) return;
    if (reply.code !== 0) { this.cli = 'missing'; return; }
    this.cliVersion = Schema.decodeUnknownSync(ModVersion)(reply.stdout.trim().replace(/^concord(?:-sdlc)?\s+v?/u, ''));
    const order = compareModVersions(this.cliVersion, this.minimumVersion);
    this.cli = order < 0 ? 'outdated' : 'ready';
    this.newerCli = order > 0;
  }

  private async resolveRoot(target: Target): Promise<{ root: string; home: string }> {
    const reply = target.machine === null
      ? await exec('git', ['rev-parse', '--show-toplevel'], { cwd: target.cwd, on: null })
      : await exec('sh', ['-c', 'printf \'%s\\n\' "$HOME"; git rev-parse --show-toplevel'], { cwd: target.cwd, on: target.machine });
    const lines = reply.stdout.trim().split('\n');
    return { root: reply.code === 0 ? lines.at(-1) ?? '' : '', home: target.machine === null ? home() : lines[0] ?? '' };
  }

  private followTerminal(cx: Context): void {
    if (this.closed) return;
    const all = panes();
    const tab = this.ownPane === undefined ? focused()?.tab : all.find(item => item.pane === this.ownPane)?.tab ?? this.tab;
    const foreground = tab !== undefined && focused()?.tab === tab;
    const resumed = foreground && !this.foreground;
    if (tab !== this.tab || foreground !== this.foreground) this.pauseWatch();
    if (tab !== this.tab) { this.tab = tab; this.observedTarget = ''; }
    this.foreground = foreground;
    for (const previous of this.terminals.keys()) if (!all.some(item => item.tab === previous)) this.terminals.delete(previous);
    const terminals = all.filter(item => item.tab === tab && item.terminal !== null && !item.mod);
    const previous = tab === undefined ? undefined : this.terminals.get(tab);
    const pane = terminals.find(item => item.focused) ?? terminals.find(item => item.pane === previous) ?? terminals[0];
    if (tab !== undefined && pane) this.terminals.set(tab, pane.pane);
    const space = spaces().find(item => item.tabs.some(item => item.id === tab));
    if (!pane?.cwd || !space) {
      this.directory = 'no-terminal'; this.target = undefined; this.pendingSwitch = undefined;
      this.pauseWatch();
      this.navigation?.cancel(); this.targetToken = {}; this.observedTarget = '';
      return;
    }
    const target = { cwd: pane.cwd, machine: space.machine };
    const key = JSON.stringify(target);
    if (key === this.observedTarget) {
      if (resumed && this.cli === 'ready' && this.directory === 'repository' && !this.disconnected) this.refresh(cx);
      return;
    }
    this.target = target; this.observedTarget = key;
    this.navigation?.cancel();
    const token = this.targetToken = {};
    const current = () => !this.closed && token === this.targetToken;
    this.navigation = cx.spawn(async next => {
      try {
        if (!this.session.root) this.directory = 'resolving';
        const resolved = await this.resolveRoot(target);
        if (!current()) return;
        this.remoteHome = resolved.home;
        const reconnecting = this.disconnected;
        this.disconnected = false;
        const different = this.session.root !== resolved.root || this.session.machine !== target.machine;
        if (different && this.editor) {
          this.pendingSwitch = { cwd: resolved.root || target.cwd, machine: target.machine };
          this.directory = 'repository'; next.notify(); return;
        }
        this.pendingSwitch = undefined;
        if (!resolved.root) { this.directory = 'not-git'; this.pauseWatch(); next.notify(); return; }
        this.directory = 'repository';
        if (!different && this.cli === 'ready') {
          if (reconnecting || this.session.error || this.watchedRoot === undefined) this.refresh(next);
          next.notify(); return;
        }
        this.useFolder(resolved.root, target.machine);
        await this.detectCli({ cwd: resolved.root, machine: target.machine }, current);
        if (!current()) return;
        if (this.cli === 'ready') this.refresh(next);
      } catch (cause) {
        if (!current()) return;
        if (target.machine !== null) this.disconnected = true;
        else this.reportFailure(cause);
      }
      if (current()) next.notify();
    });
  }

  private run<A, E>(cx: Context, effect: Effect.Effect<A, E> | ((cx: Context) => Effect.Effect<A, E>), after?: (cx: Context) => void): void {
    const session = this.session;
    for (const task of this.tasks) if (task.is_done()) this.tasks.delete(task);
    const task = cx.spawn(async current => {
      try {
        await runEffect(typeof effect === 'function' ? effect(current) : effect);
        this.tasks.delete(task); // A completed action may switch folders and cancel other tasks.
        if (!session.closed && session === this.session) after?.(current);
      } catch (cause) {
        if (!session.closed && session === this.session) {
          if (cause instanceof ModDisconnected) this.disconnected = true;
          else this.reportFailure(cause, session);
        }
      }
      this.tasks.delete(task);
      if (!session.closed && session === this.session) current.notify();
    });
    this.tasks.add(task);
  }

  private useFolder(cwd: string, machine: string | null): void {
    this.session.stop();
    this.pauseWatch();
    for (const task of this.tasks) task.cancel();
    this.tasks.clear(); this.watchedRoot = undefined;
    this.refreshing = false; this.refreshQueued = false;
    this.editor?.release(); this.editor = undefined;
    this.preview?.release(); this.preview = undefined;
    this.conceptText = undefined;
    this.session = new ModSession({ exec }, cwd, machine);
    this.expanded.clear(); this.busy.clear();
    this.collapsedGroups = new Set(documentGroups.filter(name => name !== 'Feature' && name !== 'Engineering'));
  }

  private refresh(cx: Context): void {
    if (this.editor) this.session.draft = this.editor.value();
    if (this.refreshing) { this.refreshQueued = true; return; }
    const session = this.session;
    const digest = session.sourceDigest;
    this.refreshing = true;
    this.run(cx, current => Effect.gen({ self: this }, function*() {
      yield* session.refresh(() => current.notify());
      this.disconnected = false; session.errorDetails = '';
      // Images and imported sketch inputs can change while Markdown stays identical.
      if (session.sourceDigest === digest) this.renderKey = '';
    }).pipe(Effect.ensuring(Effect.sync(() => { if (session === this.session) this.refreshing = false; }))), current => {
      this.watch(current);
      if (this.refreshQueued) { this.refreshQueued = false; this.refresh(current); }
    });
  }

  private pauseWatch(): void {
    this.watchToken = {};
    this.watcher?.cancel(); this.polling?.cancel();
    this.watcher = undefined; this.polling = undefined; this.watchedRoot = undefined;
  }

  private pollLater(cx: Context): void {
    const session = this.session;
    this.polling?.cancel();
    this.polling = cx.timer.after(2000, next => { if (!session.closed && session === this.session && this.foreground) this.refresh(next); });
  }

  private watch(cx: Context): void {
    const session = this.session;
    if (!this.foreground) return;
    // An uninitialized repository has no workspace to wait on; read it again until `concord init` runs.
    if (!session.initialized) { this.pauseWatch(); this.pollLater(cx); return; }
    if (this.watchedRoot === session.root) return;
    this.pauseWatch(); this.watchedRoot = session.root;
    const token = this.watchToken;
    this.watcher = cx.spawn(async current => {
      try {
        while (!session.closed && token === this.watchToken && this.foreground) {
          const reply = await runEffect(session.wait());
          if (session.closed || session !== this.session || token !== this.watchToken || !this.foreground) return;
          session.workspaceDigest = reply.sourceDigest ?? undefined;
          if (reply.changed) this.refresh(current);
        }
      } catch (cause) {
        if (session.closed || session !== this.session || token !== this.watchToken || !this.foreground) return;
        this.watchedRoot = undefined;
        if (cause instanceof ModDisconnected) { this.disconnected = true; current.notify(); return; }
        if (!(cause instanceof ModFailure) || !/^(?:Hawdb|Workspace|ProjectNotInitialized$)/u.test(cause.code ?? '')) {
          this.reportFailure(cause, session); current.notify();
        }
        this.pollLater(current);
      }
    });
  }

  private open(path: string, cx: Context): void {
    this.session.draft = undefined; this.session.conflict = false;
    this.editor?.release(); this.editor = undefined;
    this.preview?.release(); this.preview = undefined;
    this.conceptText = undefined;
    this.expandPath(path);
    this.run(cx, this.session.open(path));
  }

  private ensureRendered(cx: Context, available: boolean): void {
    const session = this.session, path = session.selected;
    const colors = theme();
    const key = available && path && !session.deleted ? JSON.stringify([session.root, session.machine, path, session.sourceDigest, colors]) : '';
    if (key === this.renderKey) return;
    this.renderKey = key;
    const token = this.renderToken = {};
    const current = () => !this.closed && token === this.renderToken && session === this.session && path === session.selected;
    // The same page stays on screen until its new rendering is ready, so a refresh swaps it in one step.
    const samePage = Boolean(key) && this.renderedPath === JSON.stringify([session.root, session.machine, path]);
    if (!samePage) {
      const previous = this.pageLease;
      this.pageLease = undefined; this.renderedPage = undefined; this.renderedPath = ''; this.expandedBlocks.clear();
      if (previous) this.releaseLease(cx, previous);
    }
    const task = cx.spawn(async next => {
      try {
        if (!path || !key || !current()) return;
        const page = await runEffect(session.renderPage(path, colors));
        if (!current()) return;
        const lease = await this.assets.prepare(page, next, current);
        if (!lease) return;
        if (!current()) { await lease.release(next); return; }
        const replaced = this.pageLease;
        this.pageLease = lease; this.renderedPage = page; this.renderedPath = JSON.stringify([session.root, session.machine, path]);
        if (replaced) await replaced.release(next);
      } catch (cause) {
        if (!current()) return;
        if (cause instanceof ModDisconnected) this.disconnected = true;
        else this.reportFailure(cause, session);
      }
      finally { this.renderTasks.delete(task); }
      if (current()) next.notify();
    });
    this.renderTasks.add(task);
  }

  private releaseLease(cx: Context, lease: RenderLease): void {
    const task = cx.spawn(async next => { try { await lease.release(next); } finally { this.renderTasks.delete(task); } });
    this.renderTasks.add(task);
  }

  private edit(cx: Context): void {
    this.editor?.release();
    this.editor = EditorState.new({ language: 'markdown', value: this.session.source, font_family: settings().font_family, font_size: 13 });
    this.session.draft = this.session.source;
    cx.notify();
  }

  private location(path: string, line: number, cx: Context): void {
    const session = this.session;
    this.run(cx, Effect.gen({ self: this }, function*() {
      const source = yield* session.read(path);
      if (session.closed || session !== this.session) return;
      this.preview?.release();
      const start = Math.max(0, line - 4);
      const excerpt = (source ?? '文件不存在').split('\n').slice(start, line + 20).map((value, index) => `${start + index + 1}  ${value}`).join('\n');
      this.preview = EditorState.new({ language: path.split('.').at(-1) ?? 'text', value: excerpt, readonly: true, font_family: settings().font_family, font_size: 12 });
      this.previewLabel = `${path}:${line}`;
    }));
  }

  private link(target: string, cx: Context): void {
    const path = markdownTarget(this.session.selected ?? 'docs/README.md', target);
    if (!path) return;
    const anchor = target.split('#')[1];
    const concept = this.session.concepts.find(item => item.path === path && item.concept.id === anchor);
    if (concept) {
      this.conceptText = `### ${concept.concept.term}\n\n${concept.concept.definition ?? ''}\n\n${concept.path}`;
      cx.notify();
    } else this.open(path, cx);
  }

  private reportFailure(cause: unknown, session = this.session): void {
    const error = failure(cause);
    session.error = error.message; session.errorDetails = error.details ?? ''; session.errorCode = error.code ?? '';
  }

  private act<A, E>(id: string, label: string, cx: Context, effect: Effect.Effect<A, E>, after?: (cx: Context) => void): void {
    if (this.busy.has(id)) return;
    const session = this.session;
    this.busy.set(id, label);
    this.run(cx, effect.pipe(Effect.ensuring(Effect.sync(() => {
      if (session === this.session) this.busy.delete(id);
    }))), after);
    cx.notify();
  }

  private button(id: string, label: string, action: (cx: Context) => void, primary = false, glyph?: IconName, disabled = false): Element {
    const busy = this.busy.get(id), enabled = !disabled && !busy;
    const element = row(id).px(10).border_1().border_color(color(primary ? 'solid' : 'border'))
      .text_size(12).bg(color(primary ? 'solid' : 'background')).text_color(color(enabled || busy ? primary ? 'solid_foreground' : 'foreground' : 'dim'))
      .children([...(glyph ? [icon(glyph)] : []), text(busy ?? label)]);
    return enabled ? element.cursor_pointer().hover(element => element.bg(color(primary ? 'solid' : 'hover'))).on_click((_event, cx) => action(cx)) : element;
  }

  private closeButton(id: string, action: (cx: Context) => void): Element {
    return clickableRow(id).w(28).child(icon('x')).on_click((_event, cx) => action(cx));
  }

  private save(cx: Context): void {
    const editor = this.editor;
    if (editor) this.act('save', '正在保存…', cx, this.session.save(editor.value()), current => {
      if (this.editor === editor) { editor.release(); this.editor = undefined; }
      this.resumeSwitch(current);
    });
  }

  private resumeSwitch(cx: Context): void {
    if (this.pendingSwitch) { this.pendingSwitch = undefined; this.observedTarget = ''; this.followTerminal(cx); }
  }

  private locationLabel(path: string, machine: string | null): string {
    const base = machine === null ? home() : this.remoteHome;
    const short = base && (path === base || path.startsWith(`${base}/`)) ? `~${path.slice(base.length)}` : path;
    return machine === null ? short : `${machine}:${short}`;
  }

  private errorElements(): Element[] {
    const session = this.session;
    if (!session.error) return [];
    return [h_flex().id('concord-error').flex_none().px(12).py(8).gap(6).items_center().border_b(1).border_color(color('border')).children([
      text(session.error).flex_1().min_w(0).text_color(color('blocked')),
      this.copyButton('copy-error', this.errorRequest(true), false),
      this.closeButton('dismiss-error', cx => { session.error = ''; session.errorDetails = ''; session.errorCode = ''; cx.notify(); }),
    ])];
  }

  /** What a person must handle goes to their agent as one request they can paste. */
  /** The copied request carries the raw output for the agent; the page only says it will. */
  private errorRequest(copied: boolean): string {
    const session = this.session;
    const where = this.locationLabel(session.root || this.target?.cwd || '', session.machine);
    const what = session.errorCode ? `${session.errorCode}：${session.error}` : session.error;
    const request = `Concord 在 ${where} 报错：${what}。\n请找出原因并修好；修好后 Concord mod 会自动恢复。`;
    if (!session.errorDetails) return request;
    return copied ? `${request}\n\n原始输出：\n${session.errorDetails}` : `${request}\n\n复制时附上原始输出（${session.errorDetails.split('\n').length} 行）`;
  }

  private cliRequest(machine: string | null): string {
    const where = machine === null ? '本机' : ` ${machine} 上`;
    return this.cli === 'outdated'
      ? `把${where}的 Concord 命令行工具升级到 ${this.minimumVersion} 或更新：运行\n${installCommand}\n然后用 concord --version 确认版本。`
      : `在${where}安装 Concord 命令行工具：运行\n${installCommand}\n然后用 concord --version 确认能运行。`;
  }

  private copyButton(id: string, request: string, primary = true): Element {
    return this.button(id, this.copied === id ? '已复制' : '复制给 agent', cx => {
      cx.write_to_clipboard(request);
      this.copied = id; this.copiedReset?.cancel();
      this.copiedReset = cx.timer.after(1500, next => { if (this.copied === id) { this.copied = ''; next.notify(); } });
      cx.notify();
    }, primary, 'copy');
  }

  private handoff(id: string, shown: string, copied = shown): Element[] {
    return [
      TextView.markdown(`${id}-request`, codeMarkdown(shown, 'text')).font_family(settings().font_family ?? '').max_w_full(),
      this.copyButton(id, copied),
    ];
  }

  private frame(toolbar: Element, children: Element[]): Element {
    return v_flex().id('concord-mod').size_full().min_w(0).min_h(0).rounded(10).overflow_hidden()
      .bg(color('background')).border_1().border_color(color('border')).text_color(color('foreground')).text_size(13)
      .on_size_change((size, cx) => { if (size.width !== this.panelWidth) { this.panelWidth = size.width; cx.notify(); } })
      .children([toolbar, ...children]);
  }

  private statusPage(toolbar: Element, title: string, description: string, extra: Element[] = []): Element {
    return this.frame(toolbar, [v_flex().id('concord-status').flex_1().min_h(0).p(12).items_center().justify_center().child(
      v_flex().max_w(360).min_w(0).items_start().gap(10).children([text(title).font_semibold(), text(description).text_color(color('muted')), ...extra]),
    )]);
  }

  private expandPath(path: string): void {
    this.collapsedGroups.delete(this.pageGroup(path));
    const segments = path.split('/');
    for (let index = 1; index < segments.length; index++) this.expanded.add(segments.slice(0, index).join('/'));
  }

  private pageGroup(path: string): DocumentGroup {
    if (path.endsWith('/concepts.md') || path === 'docs/taste.md' || path === 'docs/writing.md') return '项目规则';
    if (path.startsWith('docs/feature/')) return 'Feature';
    if (path.startsWith('docs/engineering/')) return 'Engineering';
    if (path.startsWith('docs/roadmap/')) return 'Roadmap';
    if (path.startsWith('docs/design/')) return 'Design';
    if (path.startsWith('docs/issues/')) return 'Issue';
    if (path.startsWith('memory/')) return 'Memory';
    return '其它文档';
  }

  private pageTree(pages: readonly { path: string; kind: string; name: string }[], prefix: string): { key: string; render: () => Element }[] {
    type Page = typeof pages[number];
    type Node = { name: string; path: string; page?: Page; children: Map<string, Node> };
    const roots = new Map<string, Node>();
    for (const page of pages) {
      const relative = page.path.startsWith(prefix) ? page.path.slice(prefix.length) : page.path;
      const segments = relative.split('/');
      let children = roots;
      let parent: Node | undefined;
      for (const [index, name] of segments.entries()) {
        const last = index === segments.length - 1;
        if (last && name === 'README.md' && parent) { parent.page = page; break; }
        let node = children.get(name);
        if (!node) {
          const path = page.path.slice(0, page.path.length - relative.length) + segments.slice(0, index + 1).join('/');
          node = { name, path, children: new Map() }; children.set(name, node);
        }
        if (last) node.page = page;
        parent = node; children = node.children;
      }
    }
    const rows: { key: string; render: () => Element }[] = [];
    const visit = (nodes: Map<string, Node>, depth: number) => {
      for (const node of [...nodes.values()].sort((a, b) => a.path.localeCompare(b.path))) {
        const directory = node.page?.path !== node.path, page = node.page;
        const owner = this.session.documents.find(owner => owner.path === page?.path);
        const title = owner?.title ?? (page?.name && page.name !== page.path ? page.name : node.name.replace(/\.md$/u, ''));
        const open = this.expanded.has(node.path);
        const glyph: IconName = directory ? open ? 'folder-open' : 'folder' : page?.kind === 'use-case' ? 'route' : 'file-text';
        rows.push({ key: node.path, render: () => {
          const element = row(`tree-row-${node.path}`).pl(8 + depth * 18).pr(6);
          if (page?.path === this.session.selected) element.bg(color('selected'));
          const marker = directory ? clickableRow(`toggle-${node.path}`).w(20).px(3).child(icon(glyph).text_color(color('muted'))).on_click((_event, cx) => {
            cx.stop_propagation();
            if (this.expanded.has(node.path)) this.expanded.delete(node.path); else this.expanded.add(node.path);
            cx.notify();
          }) : h_flex().w(20).px(3).flex_none().child(icon(glyph).text_color(color('muted')));
          const label = h_flex().id(page ? `page-${page.path}` : `directory-${node.path}`).h(28).flex_1().min_w(0).gap(7).items_center().rounded(7).cursor_pointer().hover(element => element.bg(color('hover')))
            .children([marker, text(title).flex_1().min_w(0).truncate()]);
          label.on_click((_event, cx) => {
            if (page) { if (directory) this.expanded.add(node.path); this.open(page.path, cx); }
            else { if (open) this.expanded.delete(node.path); else this.expanded.add(node.path); cx.notify(); }
          });
          return element.child(label);
        } });
        if (directory && open) visit(node.children, depth + 1);
      }
    };
    visit(roots, 0);
    return rows;
  }

  private documentList(): Element {
    const session = this.session;
    const roots = session.documents.map(owner => ({ path: owner.path, kind: owner.kind, name: owner.title }));
    const entries = [...new Map([...session.pages, ...roots].map(page => [page.path, page])).values()];
    const rows = documentGroups.flatMap(label => {
      const pages = entries.filter(page => this.pageGroup(page.path) === label);
      if (!pages.length) return [];
      const collapsed = this.collapsedGroups.has(label);
      const header = { key: `category-${label}`, render: () => clickableRow(`category-${label}`).children([
        heading(label), heading(String(pages.length)),
      ]).on_click((_event, cx) => {
        if (collapsed) this.collapsedGroups.delete(label); else this.collapsedGroups.add(label);
        cx.notify();
      }) };
      if (collapsed) return [header];
      const prefix = label === 'Feature' ? 'docs/feature/' : label === 'Engineering' ? 'docs/engineering/' : label === 'Roadmap' ? 'docs/roadmap/' : undefined;
      const children = prefix ? this.pageTree(pages, prefix) : pages.map(page => ({ key: page.path, render: () => {
        const element = clickableRow(`page-${page.path}`).children([icon('file-text').text_color(color('muted')), text(page.name === page.path ? page.path.split('/').at(-1)!.replace(/\.md$/u, '') : page.name).min_w(0).flex_1().truncate()]);
        if (page.path === session.selected) element.bg(color('selected'));
        return element.on_click((_event, cx) => this.open(page.path, cx));
      } }));
      return [header, ...children];
    });
    const navigation = v_flex().id('concord-navigation').flex_1().min_w(0).min_h(0).p(6);
    return !session.loaded ? navigation.child(text('正在读取文档…').p(8).text_color(color('dim')))
      // Rows carry their own click targets (folder and title), which herdr-app refuses inside a
      // virtual list renderer. The id keeps the scroll position across refreshes and unmounts.
      : navigation.child(v_flex().id('concord-tree').flex_1().min_h(0).overflow_y_scroll().children(rows.map(row => row.render())));
  }

  private banner(id: string, message: string, actions: Element[] = [], tone = 'blocked'): Element {
    return v_flex().id(id).flex_none().px(12).py(8).gap(6).border_b(1).border_color(color('border')).children([
      text(message).text_color(color(tone)), ...actions,
    ]);
  }

  private relationshipElements(): Element[] {
    const session = this.session;
    const tests = session.detail.tests ?? [], codes = session.detail.codeDeclarations ?? [];
    const references = [...new Set([...tests.map(item => item.contract), ...codes.flatMap(item => item.contracts)]
      .filter(ref => ref === session.selected || ref.startsWith(`${session.selected}#`)))];
    if (!references.length) return [];
    const sections: Element[] = [];
    for (const [label, glyph, items] of [
      ['守护它的测试', 'flask-conical', tests.map(item => ({ ...item, contracts: [item.contract] }))],
      ['实现它的代码', 'code', codes.map(item => ({ ...item, name: item.symbol ?? '实现' }))],
    ] as const) {
      if (!items.length) continue;
      sections.push(heading(label));
      for (const ref of references) {
        const group = items.filter(item => item.contracts.includes(ref));
        if (!group.length) continue;
        const anchor = ref.split('#')[1];
        const step = anchor ? [...session.source.matchAll(/^.*\{#([^}]+)\}.*$/gmu)].find(match => match[1] === anchor)?.[0].replace(/^\s*(?:#+|\d+\.)\s*/u, '').replace(/\s*\{#[^}]+\}.*$/u, '') ?? anchor : '整页关联';
        sections.push(heading(step));
        for (const [index, item] of group.entries()) sections.push(clickableRow(`${glyph}-${ref}-${index}`).children([
          icon(glyph), text(item.name).min_w(0).flex_1().truncate(), mono(`${item.file}:${item.line}`).text_color(color('dim')).truncate(),
        ]).on_click((_event, cx) => this.location(item.file, item.line, cx)));
      }
    }
    return [v_flex().id('concord-relationships').border_t(1).border_color(color('border')).py(12).gap(6).children(sections)];
  }

  private pageView(): Element {
    const session = this.session;
    if (!session.selected) return v_flex().id('concord-page').flex_1().min_w(0).min_h(0).items_center().justify_center().child(text('选一页开始阅读').text_color(color('dim')));
    const toolbar = h_flex().id('page-toolbar').flex_none().min_w(0).h(42).px(12).gap(6).items_center().border_b(1).border_color(color('border')).children([
      text(session.selected).text_size(12).text_color(color('dim')).flex_1().min_w(0).truncate(),
      ...(this.editor ? [
        this.button('discard', '放弃修改', cx => { this.open(session.selected!, cx); this.resumeSwitch(cx); }, false, undefined, this.busy.has('save')),
        this.button('save', '保存并检查', cx => this.save(cx), true),
      ] : session.deleted ? [] : [this.button('edit', '编辑', cx => this.edit(cx))]),
    ]);
    const banners: Element[] = [];
    if (session.check) banners.push(this.banner('concord-check', session.check.ok ? '检查通过' : `${session.check.findings.length} 个问题`, session.check.findings.map((finding, index) =>
      clickableRow(`finding-${index}`).children([mono(`${finding.path}:${finding.line ?? 1}`), text(finding.message).min_w(0).truncate()]).on_click((_event, cx) => this.location(finding.path, finding.line ?? 1, cx))), session.check.ok ? 'done' : 'blocked'));
    if (session.deleted) banners.push(this.banner('concord-deleted', '这页已被删除', [this.button('close-deleted', '关闭页面', cx => { session.selected = undefined; cx.notify(); })]));
    if (session.conflict) banners.push(this.banner('concord-conflict', '文件已变化；草稿已保留。', [this.button('merge', '查看磁盘版本并重新合并', cx => this.act('merge', '正在读取…', cx, Effect.tryPromise(async () => {
      const path = session.selected!;
      const disk = await runEffect(session.read(path));
      if (disk === null || session.closed || session !== this.session || session.selected !== path) return;
      this.preview?.release(); this.preview = EditorState.new({ language: 'markdown', value: disk, readonly: true, font_family: settings().font_family, font_size: 12 });
      this.previewLabel = '磁盘版本；请在草稿中合并';
      const draft = this.editor?.value(); session.draft = undefined;
      await runEffect(session.open(path, false)); session.draft = draft;
    })))]));
    if (this.pendingSwitch) banners.push(this.banner('concord-switch', `终端已切到 ${this.locationLabel(this.pendingSwitch.cwd, this.pendingSwitch.machine)}，保存或放弃修改后切换`));
    const body: Element[] = [];
    if (this.conceptText) body.push(v_flex().id('concord-concept-card').p(12).gap(6).rounded(7).bg(color('raised')).children([
      h_flex().child(div().flex_1()).child(this.closeButton('close-concept', cx => { this.conceptText = undefined; cx.notify(); })),
      TextView.markdown('concord-concept', this.conceptText),
    ]));
    if (!this.editor && !session.deleted) body.push(v_flex().id(`${this.renderedPage ? 'concord-body' : 'concord-loading'}-${session.selected}`).min_w(0).gap(6).children(this.renderedPage && this.pageLease
      ? renderedPageElements(this.renderedPage, this.pageLease.paths, this.expandedBlocks, (index, cx) => {
        if (this.expandedBlocks.has(index)) this.expandedBlocks.delete(index); else this.expandedBlocks.add(index);
        cx.notify();
      }, (url, cx) => this.link(url, cx)) : [text('正在渲染页面…').text_color(color('dim'))]), ...this.relationshipElements());
    if (this.preview) body.push(v_flex().id('concord-source-preview').gap(6).border_t(1).border_color(color('border')).py(12).children([
      h_flex().gap(6).items_center().children([mono(this.previewLabel).flex_1().min_w(0).truncate(), this.closeButton('close-preview', cx => { this.preview?.release(); this.preview = undefined; cx.notify(); })]),
      Editor.new(this.preview).id('concord-source-editor').h(240).min_h(0),
    ]));
    return v_flex().id('concord-page').flex_1().min_w(0).min_h(0).children([toolbar, ...banners,
      ...(this.editor ? [Editor.new(this.editor).id('document-editor').flex_1().min_h(0)] : []),
      ...(!this.editor || this.preview || this.conceptText ? [v_flex().id(`concord-document-${session.selected}`).flex_1().min_w(0).min_h(0).overflow_y_scroll().p(12).gap(10).children(body)] : []),
    ]);
  }

  render(cx: Context): Element {
    this.followTerminal(cx);
    const session = this.session;
    const available = this.directory === 'repository' && this.cli === 'ready' && !this.disconnected;
    const machine = this.directory === 'not-git' ? this.target?.machine ?? null : session.machine;
    const path = this.directory === 'no-terminal' ? '' : this.directory === 'not-git' ? this.target?.cwd ?? '' : session.root || this.target?.cwd || '';
    const location = path ? this.locationLabel(path, machine) : '';
    const toolbar = h_flex().id('concord-toolbar').h(42).flex_none().min_w(0).px(14).gap(8).items_center().border_b(1).border_color(color('border')).children([
      ...(available && session.initialized ? [clickableRow('toggle-documents').w(28).child(icon(this.treeHidden ? 'panel-left-open' : 'panel-left-close')).on_click((_event, current) => { this.treeHidden = !this.treeHidden; current.notify(); })] : []),
      text('Concord').font_semibold(), text(location).id('concord-repository').text_size(12).text_color(color('dim')).flex_1().min_w(0).truncate(),
    ]);
    if (this.directory === 'no-terminal') return this.statusPage(toolbar, '先在这个 tab 里打开一个终端', '终端报告目录后，Concord 会自动跟随');
    if (this.disconnected) return this.statusPage(toolbar, `连不上 ${this.target?.machine ?? session.machine}`, 'Herdr 恢复连接后自动重试');
    if (this.directory === 'not-git') return this.statusPage(toolbar, '这里不是 Git 仓库', location, [text('在终端里 cd 到一个 Git 仓库，mod 会跟着切换')]);
    if (session.error && !session.loaded) return this.statusPage(toolbar, session.error, location, this.handoff('copy-error', this.errorRequest(false), this.errorRequest(true)));
    if (this.cli !== 'ready') {
      if (this.cli === 'checking') return this.statusPage(toolbar, '正在检测 Concord 命令行工具…', location);
      return this.statusPage(toolbar,
        this.cli === 'missing' ? machine === null ? '这个 mod 需要 Concord 命令行工具' : `${machine} 上没有 Concord 命令行工具`
          : `${machine === null ? 'Concord' : `${machine} 上的 Concord`} 版本过旧`,
        this.cli === 'missing' ? '让 agent 装好后，mod 自动继续'
          : `${machine === null ? '' : `${machine} 上的 `}Concord 当前版本：${this.cliVersion}；要求的最低版本：${this.minimumVersion}`,
        this.handoff('copy-cli', this.cliRequest(machine)));
    }
    // Background reads keep the page as it is; only the first read of a repository says it is reading.
    if (!session.loaded) return this.statusPage(toolbar, '正在读取 Concord 仓库…', location);
    if (!session.initialized) return this.statusPage(toolbar, '这个仓库还没有初始化 Concord', location, [
      this.button('initialize', '在这里初始化 Concord', current => this.act('initialize', '正在初始化…', current, session.initialize(), next => this.watch(next)), true),
      ...this.errorElements(),
    ]);
    this.ensureRendered(cx, available);
    const notices = this.errorElements();
    if (this.newerCli) notices.push(this.banner('concord-update', '运行 concord herdr install，将 mod 更新到与命令行相同的版本。', [], 'muted'));
    // @concord-begin
    // @concord-implements docs/feature/herdr-mod/use-case/init-from-herdr.md#guide
    // @concord-implements docs/feature/project-onboarding/use-case/start-writing-specs.md#guide
    // @concord-implements docs/feature/project-onboarding/use-case/start-writing-specs.md#read-guide
    if (session.initialization) notices.push(this.banner('concord-initialized', `新建了 ${session.initialization.createdPaths.length} 个文件`, [
      text('下一步：让 agent 读写作指南'), mono(`concord --skill ${session.initialization.guide}`),
      this.button('read-guide', '阅读指南', current => this.act('read-guide', '正在读取…', current, session.readGuide())),
    ], 'done'));
    if (session.guideSource !== undefined) notices.push(TextView.markdown('concord-writing-guide', session.guideSource));
    // @concord-end
    return this.frame(toolbar, [...notices, h_flex().id('concord-columns').flex_1().min_h(0).items_stretch().children([
      ...(!this.treeHidden ? [v_flex().id('concord-sidebar').w(Math.max(160, Math.min(240, this.panelWidth * 0.4))).flex_none().min_h(0).border_r(1).border_color(color('border')).child(this.documentList())] : []),
      this.pageView(),
    ])]);
  }

  async close(cx: AsyncContext): Promise<void> {
    this.closed = true; this.targetToken = {};
    this.navigation?.cancel(); this.retry?.cancel();
    this.renderToken = {};
    this.session.stop();
    this.pauseWatch();
    for (const task of this.tasks) task.cancel();
    this.tasks.clear();
    this.editor?.release(); this.preview?.release();
    await this.assets.close(cx);
    for (const task of this.renderTasks) task.cancel();
    this.renderTasks.clear();
  }
}
