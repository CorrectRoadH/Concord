// @concord-file
// @concord-implements docs/feature/herdr-mod/README.md
// @concord-implements docs/feature/herdr-mod/use-case/read-spec.md#open-feature
import { Effect, Scheduler, Schema } from 'effect';
import { View, div, type AsyncContext, type Context, type Element, type Task } from 'gpui-kit';
import { h_flex, v_flex, TextView, Editor, EditorState, Input, InputState } from 'gpui-base';
import { exec, readTextFile, writeTextFile, watchFolder, pickFolder, focused, panes, spaces, run, closeOverlay, appHome, props as hostProps, theme } from 'herdr';
import { ModSession, markdownTarget } from './session.ts';
import { ModManifest, ModVersion, compareModVersions } from '../../model/herdr-mod/index.ts';

const color = (name: string) => theme()[name] ?? '#888888';
const text = (value: string) => div().child(value);
const runEffect = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect, { scheduler: new Scheduler.MixedScheduler('sync') });

export default class ConcordMod extends View {
  private session = new ModSession({ exec, readTextFile, writeTextFile }, '');
  private tasks = new Set<Task>();
  private watcher: Task | undefined;
  private debounce: Task | undefined;
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
  private minimumVersion = '';
  private newerCli = false;
  private initialCwd: string | undefined;
  private remote = false;

  init(initialProps: Readonly<Record<string, unknown>> | undefined, cx: AsyncContext): void {
    const props = { ...hostProps(), ...initialProps };
    const focus = focused();
    const allPanes = panes();
    const pane = allPanes.find(item => item.pane === focus?.pane) ?? allPanes.find(item => item.focused);
    const space = spaces().find(item => item.id === focus?.space) ?? spaces().find(item => item.active);
    this.remote = space?.machine != null;
    if (this.remote) return;
    const cwd = typeof props?.cwd === 'string' && props.cwd ? props.cwd : focus?.cwd || pane?.cwd || space?.folder;
    // mod.open is an overlay on the host; its explicit command opens our right pane.
    if (typeof props?.overlay === 'string') {
      const existing = allPanes.find(item => item.mod === 'concord' && item.tab === focus?.tab);
      if (existing || pane) {
        if (existing) run('pane.focus', { pane: existing.pane });
        else run('pane.split', { pane: pane!.pane, direction: 'right', mod: 'concord', props: cwd ? { cwd } : {} });
        closeOverlay(props.overlay);
        return;
      }
    }
    this.name = InputState.new({ placeholder: 'Feature 名称' });
    this.title = InputState.new({ placeholder: '标题' });
    this.initialCwd = typeof props?.overlay === 'string' && !pane ? undefined : cwd;
    this.detectCli(cx);
  }

  private detectCli(cx: Context): void {
    this.cli = 'checking';
    this.session.error = '';
    this.run(cx, Effect.tryPromise(async () => {
      const source = await readTextFile(`${appHome()}/mods/concord/mod.json`);
      const manifest = Schema.decodeUnknownSync(Schema.fromJsonString(ModManifest), { onExcessProperty: 'ignore' })(source);
      this.minimumVersion = manifest.minimumConcordVersion;
      let reply;
      try { reply = await exec('concord', ['--version']); }
      catch { this.cli = 'missing'; return; }
      if (reply.code !== 0) { this.cli = 'missing'; return; }
      this.cliVersion = Schema.decodeUnknownSync(ModVersion)(reply.stdout.trim().replace(/^concord(?:-sdlc)?\s+v?/u, ''));
      const order = compareModVersions(this.cliVersion, this.minimumVersion);
      this.cli = order < 0 ? 'outdated' : 'ready';
      this.newerCli = order > 0;
    }), current => {
      if (this.cli !== 'ready') return;
      if (this.initialCwd) this.useFolder(this.initialCwd, current);
      else this.session.error = '没有可用的当前目录。';
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
        if (!session.closed) session.error = cause instanceof Error ? cause.message : String(cause);
      }
      this.tasks.delete(task);
      if (!session.closed && session === this.session) current.notify();
    });
    this.tasks.add(task);
  }

  private useFolder(cwd: string, cx: Context): void {
    this.session.stop();
    this.watcher?.cancel(); this.debounce?.cancel(); this.polling?.cancel();
    for (const task of this.tasks) task.cancel();
    this.tasks.clear(); this.watchedRoot = undefined;
    this.editor?.release(); this.editor = undefined;
    this.preview?.release(); this.preview = undefined;
    this.conceptText = undefined;
    this.session = new ModSession({ exec, readTextFile, writeTextFile }, cwd);
    this.refresh(cx);
  }

  private refresh(cx: Context): void {
    if (this.editor) this.session.draft = this.editor.value();
    const session = this.session;
    this.run(cx, current => session.refresh(() => current.notify()), current => this.watch(current));
  }

  private watch(cx: Context): void {
    const session = this.session;
    if (this.watchedRoot === session.root) return;
    this.watcher?.cancel(); this.polling?.cancel(); this.watchedRoot = session.root;
    this.watcher = cx.spawn(async current => {
      try {
        while (!session.closed) {
          const paths = await watchFolder(session.root);
          if (session.closed || session !== this.session) return;
          if (!paths.some(path => {
            if (path === session.root) return true;
            const relative = path.startsWith(`${session.root}/`) ? path.slice(session.root.length + 1) : path;
            return relative === 'concord.config.ts' || session.watchRoots.some(root => relative === root || relative.startsWith(`${root}/`));
          })) continue;
          this.debounce?.cancel();
          this.debounce = current.timer.after(200, next => this.refresh(next));
        }
      } catch {
        if (session.closed || session !== this.session) return;
        // The host rejects watches above its Linux directory or folder budget.
        // Keep observing through fresh timer contexts without a tight retry loop.
        this.polling = current.timer.every(1000, next => {
          if (!session.closed && session === this.session) this.refresh(next);
        });
      }
    });
  }

  private open(path: string, cx: Context): void {
    this.editor?.release(); this.editor = undefined;
    this.preview?.release(); this.preview = undefined;
    this.conceptText = undefined;
    this.run(cx, this.session.open(path));
  }

  private edit(cx: Context): void {
    this.editor?.release();
    this.editor = EditorState.new({ language: 'markdown', value: this.session.source });
    this.session.draft = this.session.source;
    cx.notify();
  }

  private location(path: string, line: number, cx: Context): void {
    const session = this.session;
    this.run(cx, Effect.tryPromise(async () => {
      const source = await readTextFile(`${session.root}/${path}`);
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
      this.run(cx, Effect.tryPromise(async () => {
        const source = await readTextFile(`${session.root}/${path}`);
        if (!session.closed && session === this.session) this.conceptText = `# ${concept.concept.term}\n\n${concept.concept.definition ?? ''}\n\n${concept.path}\n\n${source ?? ''}`;
      }));
    } else this.open(path, cx);
  }

  private button(id: string, label: string, action: (cx: Context) => void): Element {
    return div().id(id).px(8).py(5).rounded(4).bg(color('raised')).text_color(color('foreground')).child(label).on_click((_event, cx) => action(cx));
  }

  private save(cx: Context): void {
    const editor = this.editor;
    if (editor) this.run(cx, this.session.save(editor.value()), () => {
      if (this.editor === editor) { editor.release(); this.editor = undefined; }
    });
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
  render(_cx: Context): Element {
    const session = this.session;
    if (this.remote) return v_flex().id('concord-mod').size_full().p(10).child('Concord mod 只能用于本机的 pane');
    if (this.cli !== 'ready') {
      const messages = this.cli === 'checking' ? ['正在检测 Concord 命令行工具…']
        : this.cli === 'missing' ? ['这个 mod 需要 Concord 命令行工具。', 'curl -fsSL https://github.com/CorrectRoadH/Concord/releases/latest/download/install.sh | sh', '安装后点“重新检测”。']
          : [`Concord 当前版本：${this.cliVersion}；要求的最低版本：${this.minimumVersion}`, 'curl -fsSL https://github.com/CorrectRoadH/Concord/releases/latest/download/install.sh | sh'];
      return v_flex().id('concord-mod').size_full().p(10).gap(8).bg(color('surface')).text_color(color('foreground')).text_size(13).children([
        text('Concord'), ...messages.map(text), ...(session.error ? [text(session.error)] : []),
        this.button('recheck-cli', '重新检测', cx => { this.detectCli(cx); cx.notify(); }),
      ]);
    }
    const choose = (cx: Context) => {
      cx.spawn(async current => { const cwd = await pickFolder({ prompt: '选择 Concord 仓库' }); if (cwd && !session.closed) this.useFolder(cwd, current); });
    };
    const toolbar = h_flex().gap(6).children([
      text('Concord').flex_1(), this.button('choose-folder', '选择目录', choose),
      ...(session.root && !session.error ? [this.button('refresh', '刷新', cx => this.refresh(cx))] : []),
      ...(session.initialized ? [this.button('new-feature', '新建 Feature', cx => { this.creating = !this.creating; cx.notify(); })] : []),
    ]);
    const status = session.error ? text(session.error.includes('Git') || /git repository/iu.test(session.error) ? '请先在 Git 仓库中打开。' : session.error).text_color(color('blocked')) : text(session.root || '请选择 Git 仓库');
    if (!session.root || (session.error && !session.initialized)) return v_flex().id('concord-mod').size_full().p(10).gap(8).bg(color('surface')).text_color(color('foreground')).text_size(13).children([toolbar, status]);
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
    const body: Element[] = [];
    if (!session.initialized && !session.error) body.push(text('这个仓库还没有初始化 Concord'), this.button('initialize', '在这里初始化 Concord', cx => this.run(cx, session.initialize(), current => this.watch(current))));
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
        const disk = await readTextFile(`${session.root}/${path}`);
        if (disk === null || session.closed || session !== this.session || session.selected !== path) return;
        this.preview?.release(); this.preview = EditorState.new({ language: 'markdown', value: disk, readonly: true }); this.previewLabel = '磁盘版本；请在草稿中合并';
        // Explicit merge begins from the newly read disk preimage, retaining the editor.
        const draft = this.editor?.value(); session.draft = undefined;
        await runEffect(session.open(session.selected!, false)); session.draft = draft;
      }))));
      if (this.editor) body.push(h_flex().gap(6).children([
        this.button('save', '保存并检查', cx => this.save(cx)),
        this.button('discard', '放弃修改', cx => this.open(session.selected!, cx)),
      ]), Editor.new(this.editor).id('document-editor').flex_1());
      else if (!session.deleted) body.push(this.button('edit', '编辑', cx => this.edit(cx)), TextView.markdown(`concord-body-${session.selected}`, session.source).on_link_click((url, cx) => this.link(url, cx)));
      const tests = session.detail.tests ?? [], codes = session.detail.codeDeclarations ?? [];
      const references = [...new Set([...tests.map(item => item.contract), ...codes.flatMap(item => item.contracts)].filter(ref => ref === session.selected || ref.startsWith(`${session.selected}#`)))];
      for (const ref of references) body.push(text(ref.includes('#') ? `步骤：${ref.split('#')[1]}` : '整页关联'), text('测试'), ...tests.filter(item => item.contract === ref).map((item, index) => this.button(`test-${ref}-${index}`, `${item.file}:${item.line}  ${item.name}`, cx => this.location(item.file, item.line, cx))), text('实现'), ...codes.filter(item => item.contracts.includes(ref)).map((item, index) => this.button(`code-${ref}-${index}`, `${item.file}:${item.line}  ${item.symbol ?? ref}`, cx => this.location(item.file, item.line, cx))));
    }
    if (this.conceptText) body.push(this.button('close-concept', '关闭术语定义', cx => { this.conceptText = undefined; cx.notify(); }), TextView.markdown('concord-concept', this.conceptText));
    if (this.preview) body.push(text(this.previewLabel), this.button('close-preview', '关闭源码', cx => { this.preview?.release(); this.preview = undefined; cx.notify(); }), Editor.new(this.preview));
    return v_flex().id('concord-mod').size_full().min_w(0).min_h(0).overflow_hidden().p(10).gap(8).bg(color('surface')).text_color(color('foreground')).text_size(13).children([
      toolbar, status, ...(this.newerCli ? [text('运行 concord herdr install，将 mod 更新到与命令行相同的版本。')] : []), h_flex().flex_1().min_h(0).items_stretch().gap(10).children([
        ...(session.initialized ? [navigation] : []),
        v_flex().id(`concord-document-${session.selected ?? 'none'}`).flex_1().min_w(0).min_h(0).overflow_y_scroll().gap(6).children(body),
      ]),
    ]);
  }

  close(_cx: AsyncContext): void {
    this.session.stop();
    this.watcher?.cancel(); this.debounce?.cancel(); this.polling?.cancel();
    for (const task of this.tasks) task.cancel();
    this.tasks.clear();
    this.editor?.release(); this.preview?.release(); this.name?.release(); this.title?.release();
  }
}
