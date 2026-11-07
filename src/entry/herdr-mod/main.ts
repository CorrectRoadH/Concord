// @concord-file
// @concord-implements docs/feature/herdr-mod/README.md
// @concord-implements docs/feature/herdr-mod/use-case/read-spec.md#open-feature
// @concord-implements docs/feature/herdr-mod/use-case/edit-and-check.md
// @concord-implements docs/feature/herdr-mod/use-case/follow-changes.md
// @concord-implements docs/feature/herdr-mod/use-case/use-on-remote-machine.md
import { Effect, Scheduler, Schema } from 'effect';
import { View, div, type AsyncContext, type Context, type Element, type Task } from 'gpui-kit';
import { h_flex, v_flex, TextView, Editor, EditorState, Input, InputState } from 'gpui-base';
import { exec, focused, panes, spaces, run, closeOverlay, home, props as hostProps, theme } from 'herdr';
import { ModSession, ModFailure, ModDisconnected, failure, markdownTarget } from './session.ts';
import { ModVersion, compareModVersions, type RenderedPage } from '../../model/herdr-mod/index.ts';
import { RenderAssets, type RenderLease } from './render-assets.ts';
import { renderedPageElements } from './rendered-page.ts';
declare const CONCORD_MOD_MINIMUM_VERSION: string;

const color = (name: string) => theme()[name] ?? '#888888';
const text = (value: string) => div().child(value);
const runEffect = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect, { scheduler: new Scheduler.MixedScheduler('sync') });
const installCommand = 'curl -fsSL https://github.com/CorrectRoadH/Concord/releases/latest/download/install.sh | sh';
type Target = { cwd: string; machine: string | null };

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
  private name: InputState | undefined;
  private title: InputState | undefined;
  private creating = false;
  private cli: 'checking' | 'missing' | 'outdated' | 'ready' = 'checking';
  private cliVersion = '';
  private minimumVersion = Schema.decodeUnknownSync(ModVersion)(typeof CONCORD_MOD_MINIMUM_VERSION === 'undefined' ? 'dev' : CONCORD_MOD_MINIMUM_VERSION);
  private newerCli = false;
  private tab: string | undefined;
  private terminal: string | undefined;
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
  private details = false;
  private closed = false;
  private assets = new RenderAssets();
  private pageLease: RenderLease | undefined;
  private renderedPage: RenderedPage | undefined;
  private renderTasks = new Set<Task>();
  private renderToken = {};
  private renderKey = '';
  private expandedBlocks = new Set<number>();

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
    this.name = InputState.new({ placeholder: 'Feature 名称' });
    this.title = InputState.new({ placeholder: '标题' });
    this.assets.start(cx);
    this.ownPane = typeof props.pane === 'string' ? props.pane : undefined;
    this.tab = allPanes.find(item => item.pane === this.ownPane)?.tab ?? focus?.tab ?? spaces().find(item => item.active)?.tabs.find(item => item.active)?.id;
    this.retry = cx.timer.every(2000, current => {
      if (this.disconnected && this.foreground && !this.closed) { this.observedTarget = ''; this.followTerminal(current); }
    });
    this.followTerminal(cx);
  }

  private async detectCli(target: Target, current: () => boolean): Promise<void> {
    this.cli = 'checking';
    this.session.error = '';
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
    const tab = all.find(item => item.pane === this.ownPane)?.tab ?? this.tab;
    const terminals = all.filter(item => item.tab === tab && item.terminal !== null && !item.mod);
    const pane = terminals.find(item => item.focused) ?? terminals.find(item => item.pane === this.terminal) ?? terminals[0];
    this.terminal = pane?.pane;
    const space = spaces().find(item => item.tabs.some(item => item.id === tab));
    if (!pane?.cwd || !space) {
      this.directory = 'no-terminal'; this.target = undefined; this.pendingSwitch = undefined;
      this.pauseWatch();
      this.navigation?.cancel(); this.targetToken = {}; this.observedTarget = '';
      return;
    }
    const target = { cwd: pane.cwd, machine: space.machine };
    const key = JSON.stringify(target);
    if (key === this.observedTarget) return;
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
        else { const error = failure(cause); this.session.error = error.message; this.session.errorDetails = error.details ?? ''; }
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
          else { const error = failure(cause); session.error = error.message; session.errorDetails = error.details ?? ''; }
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
    this.creating = false; this.details = false;
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

  private watch(cx: Context): void {
    const session = this.session;
    if (!this.foreground || this.watchedRoot === session.root) return;
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
        if (!(cause instanceof ModFailure) || !/^(?:Hawdb|Workspace)/u.test(cause.code ?? '')) {
          const error = failure(cause); session.error = error.message; session.errorDetails = error.details ?? ''; current.notify();
        }
        this.polling = current.timer.after(2000, next => { if (!session.closed && session === this.session && this.foreground) this.refresh(next); });
      }
    });
  }

  private open(path: string, cx: Context): void {
    this.session.draft = undefined; this.session.conflict = false;
    this.editor?.release(); this.editor = undefined;
    this.preview?.release(); this.preview = undefined;
    this.conceptText = undefined;
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
    const previous = this.pageLease;
    this.pageLease = undefined; this.renderedPage = undefined; this.expandedBlocks.clear();
    const task = cx.spawn(async next => {
      try {
        await previous?.release(next);
        if (!path || !key || !current()) return;
        const page = await runEffect(session.renderPage(path, colors));
        if (!current()) return;
        const lease = await this.assets.prepare(page, next, current);
        if (!lease) return;
        if (!current()) { await lease.release(next); return; }
        this.pageLease = lease; this.renderedPage = page;
      } catch (cause) {
        if (!current()) return;
        if (cause instanceof ModDisconnected) this.disconnected = true;
        else { const error = failure(cause); session.error = error.message; session.errorDetails = error.details ?? ''; }
      }
      finally { this.renderTasks.delete(task); }
      if (current()) next.notify();
    });
    this.renderTasks.add(task);
  }

  private edit(cx: Context): void {
    this.editor?.release();
    this.editor = EditorState.new({ language: 'markdown', value: this.session.source });
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
      this.preview = EditorState.new({ language: path.split('.').at(-1) ?? 'text', value: excerpt, readonly: true });
      this.previewLabel = `${path}:${line}`;
    }));
  }

  private link(target: string, cx: Context): void {
    const session = this.session;
    const path = markdownTarget(this.session.selected ?? 'docs/README.md', target);
    if (!path) return;
    const anchor = target.split('#')[1];
    const concept = this.session.concepts.find(item => item.path === path && item.concept.id === anchor);
    if (concept) {
      this.run(cx, Effect.gen({ self: this }, function*() {
        const source = yield* session.read(path);
        if (!session.closed && session === this.session) this.conceptText = `# ${concept.concept.term}\n\n${concept.concept.definition ?? ''}\n\n${concept.path}\n\n${source ?? ''}`;
      }));
    } else this.open(path, cx);
  }

  private button(id: string, label: string, action: (cx: Context) => void, primary = false): Element {
    return div().id(id).px(8).py(5).rounded(4).bg(color(primary ? 'solid' : 'raised')).text_color(color(primary ? 'solid_foreground' : 'foreground')).child(label).on_click((_event, cx) => action(cx));
  }

  private save(cx: Context): void {
    const editor = this.editor;
    if (editor) this.run(cx, this.session.save(editor.value()), current => {
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
    return session.error ? [text(session.error), ...(session.errorDetails ? [
      this.button('error-details', '详情', cx => { this.details = !this.details; cx.notify(); }),
      ...(this.details ? [TextView.markdown('concord-error-details', `\`\`\`text\n${session.errorDetails.replaceAll('```', '~~~')}\n\`\`\``)] : []),
    ] : [])] : [];
  }

  private statusPage(toolbar: Element, title: string, description: string, extra: Element[] = []): Element {
    return v_flex().id('concord-mod').size_full().min_w(0).min_h(0).p(10).gap(8).bg(color('surface')).text_color(color('foreground')).text_size(13).children([
      toolbar, v_flex().id('concord-status').flex_1().min_h(0).items_center().justify_center().child(
        v_flex().max_w(360).min_w(0).items_start().gap(10).children([text(title), text(description).text_color(color('muted')), ...extra]),
      ),
    ]);
  }

  private pageTree(pages: readonly { path: string; name: string }[], prefix: string): Element[] {
    type Node = { name: string; path: string; page?: typeof pages[number]; children: Map<string, Node> };
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
          node = { name, path, children: new Map() };
          children.set(name, node);
        }
        if (last) node.page = page;
        parent = node;
        children = node.children;
      }
    }
    const render = (nodes: Map<string, Node>): Element[] => [...nodes.values()].sort((a, b) => a.path.localeCompare(b.path)).map(node => {
      const directory = node.page?.path !== node.path;
      const owner = this.session.documents.find(owner => owner.path === node.page?.path);
      const label = directory ? owner?.title ?? node.name : node.page?.name ?? node.name;
      const heading = node.page ? this.button(`page-${node.page.path}`, label, cx => this.open(node.page!.path, cx)) : text(label);
      return directory ? v_flex().id(`directory-${node.path}`).gap(2).children([
        heading, v_flex().px(8).gap(2).children(render(node.children)),
      ]) : heading;
    });
    return render(roots);
  }
  render(cx: Context): Element {
    this.followTerminal(cx);
    const foreground = focused()?.tab === this.tab;
    if (foreground !== this.foreground) {
      this.foreground = foreground; this.pauseWatch();
      if (foreground && this.cli === 'ready' && this.directory === 'repository' && !this.disconnected) this.refresh(cx);
    }
    const session = this.session;
    const available = this.directory === 'repository' && this.cli === 'ready' && !this.disconnected;
    this.ensureRendered(cx, available);
    const machine = this.directory === 'not-git' ? this.target?.machine ?? null : session.machine;
    const path = this.directory === 'no-terminal' ? '' : this.directory === 'not-git' ? this.target?.cwd ?? '' : session.root || this.target?.cwd || '';
    const location = path ? this.locationLabel(path, machine) : '';
    const toolbar = h_flex().gap(6).children([
      text('Concord'), text(location).text_color(color('muted')).flex_1(),
      ...(available && session.initialized ? [this.button('new-feature', '新建 Feature', current => { this.creating = !this.creating; current.notify(); })] : []),
    ]);
    if (this.directory === 'no-terminal') return this.statusPage(toolbar, '先在这个 tab 里打开一个终端', '终端报告目录后，Concord 会自动跟随。');
    if (this.disconnected) return this.statusPage(toolbar, `连不上 ${this.target?.machine ?? session.machine}`, 'Herdr 恢复连接后自动重试');
    if (this.directory === 'not-git') return this.statusPage(toolbar, '这里不是 Git 仓库', location, [text('在终端里 cd 到一个 Git 仓库，mod 会跟着切换')]);
    if (session.error && !session.initialized) return this.statusPage(toolbar, session.error, location, this.errorElements().slice(1));
    if (this.cli !== 'ready') {
      if (this.cli === 'checking') return this.statusPage(toolbar, '正在检测 Concord 命令行工具…', location);
      return this.statusPage(toolbar,
        this.cli === 'missing' ? machine === null ? '这个 mod 需要 Concord 命令行工具。' : `${machine} 上没有 Concord 命令行工具`
          : `${machine === null ? 'Concord' : `${machine} 上的 Concord`} 版本过旧`,
        this.cli === 'missing' ? machine === null ? '安装后点“重新检测”。' : `在 ${machine} 的终端里运行安装命令，装好后点重新检测`
          : `${machine === null ? '' : `${machine} 上的 `}Concord 当前版本：${this.cliVersion}；要求的最低版本：${this.minimumVersion}`,
        [TextView.markdown('concord-install-command', `\`\`\`sh\n${installCommand}\n\`\`\``),
          this.button('recheck-cli', '重新检测', current => { this.cli = 'checking'; this.observedTarget = ''; this.followTerminal(current); current.notify(); }, true)],
      );
    }
    if (!session.initialized) return this.statusPage(toolbar, this.refreshing ? '正在读取 Concord 仓库…' : '这个仓库还没有初始化 Concord', location,
      this.refreshing ? [] : [this.button('initialize', '在这里初始化 Concord', current => this.run(current, session.initialize(), next => this.watch(next)), true)]);
    const roots = session.documents.map(owner => ({ path: owner.path, kind: owner.kind, name: owner.title }));
    const entries = [...new Map([...roots, ...session.pages].map(page => [page.path, page])).values()];
    const categories: readonly [string, string, (page: typeof entries[number]) => boolean][] = [
      ['Feature 与 Use Case', 'docs/feature/', page => page.path.startsWith('docs/feature/')],
      ['品味', 'docs/', page => page.path === 'docs/taste.md'],
      ['术语', 'docs/', page => page.path.endsWith('/concepts.md')],
      ['Issue', 'docs/issues/', page => page.kind === 'issue'], ['Memory', 'memory/', page => page.kind === 'memory'],
      ['其它文档', 'docs/', page => !page.path.startsWith('docs/feature/') && page.path !== 'docs/taste.md' && !page.path.endsWith('/concepts.md') && page.kind !== 'issue' && page.kind !== 'memory'],
    ];
    const navigation = v_flex().id('concord-tree').w(220).min_h(0).overflow_y_scroll().gap(4).children(categories.flatMap(([label, prefix, includes]) => [
      text(label), ...this.pageTree(entries.filter(includes), prefix),
    ]));
    const body: Element[] = this.errorElements();
    // @concord-begin
    // @concord-implements docs/feature/herdr-mod/use-case/init-from-herdr.md#guide
    // @concord-implements docs/feature/project-onboarding/use-case/start-writing-specs.md#guide
    // @concord-implements docs/feature/project-onboarding/use-case/start-writing-specs.md#read-guide
    if (session.initialization) body.push(
      text(`新建了 ${session.initialization.createdPaths.length} 个文件`),
      text('下一步：让 agent 读写作指南'),
      text(`concord --skill ${session.initialization.guide}`),
      this.button('read-guide', '阅读指南', cx => this.run(cx, session.readGuide())),
    );
    if (session.guideSource !== undefined) body.push(TextView.markdown('concord-writing-guide', session.guideSource));
    // @concord-end
    if (this.creating && this.name && this.title) body.push(Input.new(this.name).id('feature-name'), Input.new(this.title).id('feature-title'), this.button('create-feature', '创建 Feature', cx => this.run(cx, session.createFeature(this.name!.value(), this.title!.value()), current => { this.creating = false; this.edit(current); })));
    if (session.check) body.push(text(session.check.ok ? 'check: ok' : `check: ${session.check.findings.length} 个问题`), ...session.check.findings.map((finding, index) => this.button(`finding-${index}`, `${finding.path}:${finding.line ?? 1}  ${finding.message}`, cx => this.location(finding.path, finding.line ?? 1, cx))));
    if (session.selected) {
      body.push(text(session.selected));
      if (session.deleted) body.push(text('这页已被删除'));
      if (session.conflict) body.push(text('文件已变化；草稿已保留。'), this.button('merge', '查看磁盘版本并重新合并', cx => this.run(cx, Effect.tryPromise(async () => {
        const path = session.selected!;
        const disk = await runEffect(session.read(path));
        if (disk === null || session.closed || session !== this.session || session.selected !== path) return;
        this.preview?.release(); this.preview = EditorState.new({ language: 'markdown', value: disk, readonly: true }); this.previewLabel = '磁盘版本；请在草稿中合并';
        // Explicit merge begins from the newly read disk preimage, retaining the editor.
        const draft = this.editor?.value(); session.draft = undefined;
        await runEffect(session.open(session.selected!, false)); session.draft = draft;
      }))));
      if (this.pendingSwitch) body.push(text(`终端已切到 ${this.pendingSwitch.cwd}，保存或放弃修改后切换`));
      if (this.editor) body.push(h_flex().gap(6).children([
        this.button('save', '保存并检查', cx => this.save(cx)),
        this.button('discard', '放弃修改', cx => { this.open(session.selected!, cx); this.resumeSwitch(cx); }),
      ]), Editor.new(this.editor).id('document-editor').flex_1());
      else if (!session.deleted) body.push(
        this.button('edit', '编辑', cx => this.edit(cx)),
        v_flex().id(`${this.renderedPage ? 'concord-body' : 'concord-loading'}-${session.selected}`).min_w(0).gap(6).children(this.renderedPage && this.pageLease
          ? renderedPageElements(this.renderedPage, this.pageLease.paths, this.expandedBlocks, (index, current) => {
            if (this.expandedBlocks.has(index)) this.expandedBlocks.delete(index); else this.expandedBlocks.add(index);
            current.notify();
          }, (url, current) => this.link(url, current)) : [text('正在渲染页面…')]),
      );
      const tests = session.detail.tests ?? [], codes = session.detail.codeDeclarations ?? [];
      const references = [...new Set([...tests.map(item => item.contract), ...codes.flatMap(item => item.contracts)].filter(ref => ref === session.selected || ref.startsWith(`${session.selected}#`)))];
      for (const ref of references) body.push(text(ref.includes('#') ? `步骤：${ref.split('#')[1]}` : '整页关联'), text('测试'), ...tests.filter(item => item.contract === ref).map((item, index) => this.button(`test-${ref}-${index}`, `${item.file}:${item.line}  ${item.name}`, cx => this.location(item.file, item.line, cx))), text('实现'), ...codes.filter(item => item.contracts.includes(ref)).map((item, index) => this.button(`code-${ref}-${index}`, `${item.file}:${item.line}  ${item.symbol ?? ref}`, cx => this.location(item.file, item.line, cx))));
    }
    if (this.conceptText) body.push(this.button('close-concept', '关闭术语定义', cx => { this.conceptText = undefined; cx.notify(); }), TextView.markdown('concord-concept', this.conceptText));
    if (this.preview) body.push(text(this.previewLabel), this.button('close-preview', '关闭源码', cx => { this.preview?.release(); this.preview = undefined; cx.notify(); }), Editor.new(this.preview));
    return v_flex().id('concord-mod').size_full().min_w(0).min_h(0).overflow_hidden().p(10).gap(8).bg(color('surface')).text_color(color('foreground')).text_size(13).children([
      toolbar, ...(this.newerCli ? [text('运行 concord herdr install，将 mod 更新到与命令行相同的版本。')] : []), h_flex().flex_1().min_h(0).items_stretch().gap(10).children([
        ...(session.initialized ? [navigation] : []),
        v_flex().id(`concord-document-${session.selected ?? 'none'}`).flex_1().min_w(0).min_h(0).overflow_y_scroll().gap(6).children(body),
      ]),
    ]);
  }

  async close(cx: AsyncContext): Promise<void> {
    this.closed = true; this.targetToken = {};
    this.navigation?.cancel(); this.retry?.cancel();
    this.renderToken = {};
    this.session.stop();
    this.pauseWatch();
    for (const task of this.tasks) task.cancel();
    this.tasks.clear();
    this.editor?.release(); this.preview?.release(); this.name?.release(); this.title?.release();
    await this.assets.close(cx);
    for (const task of this.renderTasks) task.cancel();
    this.renderTasks.clear();
  }
}
