// @concord-file
// @concord-implements docs/feature/herdr-mod/README.md
import { Effect, Scheduler } from 'effect';
import { View, div, type Context, type Element, type Task } from 'gpui-kit';
import { h_flex, v_flex, TextView, Editor, EditorState, Input, InputState } from 'gpui-base';
import { exec, readTextFile, writeTextFile, watchFolder, pickFolder, focused, theme } from 'herdr';
import { ModSession, markdownTarget } from './session.js';

const color = (name: string) => theme()[name] ?? '#888888';
const text = (value: string) => div().child(value);
const runEffect = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect, { scheduler: new Scheduler.MixedScheduler('sync') });

export default class ConcordMod extends View {
  private session = new ModSession({ exec, readTextFile, writeTextFile }, '');
  private tasks = new Set<Task>();
  private watcher: Task | undefined;
  private debounce: Task | undefined;
  private watchedRoot: string | undefined;
  private editor: EditorState | undefined;
  private preview: EditorState | undefined;
  private previewLabel = '';
  private conceptText: string | undefined;
  private name: InputState | undefined;
  private title: InputState | undefined;
  private creating = false;

  init(_props: Readonly<Record<string, unknown>> | undefined, cx: Context): void {
    this.name = InputState.new({ placeholder: 'Feature 名称' });
    this.title = InputState.new({ placeholder: '标题' });
    const cwd = focused()?.cwd;
    if (cwd) this.useFolder(cwd, cx);
  }

  private run<A, E>(cx: Context, effect: Effect.Effect<A, E> | ((cx: Context) => Effect.Effect<A, E>), after?: (cx: Context) => void): void {
    const session = this.session;
    for (const task of this.tasks) if (task.is_done()) this.tasks.delete(task);
    const task = cx.spawn(async current => {
      try {
        await runEffect(typeof effect === 'function' ? effect(current) : effect);
        if (!session.closed && session === this.session) after?.(current);
      } catch (cause) {
        if (!session.closed) session.error = cause instanceof Error ? cause.message : String(cause);
      }
      if (!session.closed && session === this.session) current.notify();
    });
    this.tasks.add(task);
  }

  private useFolder(cwd: string, cx: Context): void {
    this.session.stop();
    this.watcher?.cancel(); this.debounce?.cancel();
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
    this.watcher?.cancel(); this.watchedRoot = session.root;
    this.watcher = cx.spawn(async current => {
      while (!session.closed) {
        const paths = await watchFolder(session.root);
        if (session.closed || session !== this.session) return;
        if (!paths.some(path => {
          const relative = path.startsWith(`${session.root}/`) ? path.slice(session.root.length + 1) : path;
          return relative === 'concord.config.ts' || session.watchRoots.some(root => relative === root || relative.startsWith(`${root}/`));
        })) continue;
        this.debounce?.cancel();
        this.debounce = current.timer.after(200, next => this.refresh(next));
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
    const path = markdownTarget(this.session.selected ?? 'docs/README.md', target);
    if (!path) return;
    const anchor = target.split('#')[1];
    const concept = this.session.concepts.find(item => item.path === path && item.concept.id === anchor);
    if (concept) {
      this.run(cx, Effect.tryPromise(async () => {
        this.conceptText = `# ${concept.concept.term}\n\n${concept.concept.definition ?? ''}\n\n${concept.path}\n\n${await readTextFile(`${this.session.root}/${path}`) ?? ''}`;
      }));
    } else this.open(path, cx);
  }

  private button(id: string, label: string, action: (cx: Context) => void): Element {
    return div().id(id).px(8).py(5).rounded(4).bg(color('raised')).text_color(color('foreground')).child(label).on_click((_event, cx) => action(cx));
  }

  render(_cx: Context): Element {
    const session = this.session;
    const choose = (cx: Context) => {
      cx.spawn(async current => { const cwd = await pickFolder({ prompt: '选择 Concord 仓库' }); if (cwd && !session.closed) this.useFolder(cwd, current); });
    };
    const toolbar = h_flex().gap(6).children([
      text('Concord').flex_1(), this.button('choose-folder', '选择目录', choose),
      this.button('refresh', '刷新', cx => this.refresh(cx)),
      this.button('new-feature', '新建 Feature', cx => { this.creating = !this.creating; cx.notify(); }),
    ]);
    const status = session.error ? text(session.error.includes('Git') || /git repository/iu.test(session.error) ? '请先在 Git 仓库中打开。' : session.error).text_color(color('blocked')) : text(session.root || '请选择 Git 仓库');
    const roots = session.documents.map(owner => ({ path: owner.path, kind: owner.kind, name: owner.title }));
    const entries = [...new Map([...roots, ...session.pages].map(page => [page.path, page])).values()];
    const categories: readonly [string, (page: typeof entries[number]) => boolean][] = [
      ['Feature 与 Use Case', page => page.path.startsWith('docs/feature/')],
      ['品味', page => page.path === 'docs/taste.md'],
      ['术语', page => page.path.endsWith('/concepts.md')],
      ['Issue', page => page.kind === 'issue'], ['Memory', page => page.kind === 'memory'],
      ['其它文档', page => !page.path.startsWith('docs/feature/') && page.path !== 'docs/taste.md' && !page.path.endsWith('/concepts.md') && page.kind !== 'issue' && page.kind !== 'memory'],
    ];
    const navigation = v_flex().id('concord-tree').w(220).min_h(0).overflow_y_scroll().gap(4).children(categories.flatMap(([label, includes]) => [
      text(label), ...entries.filter(includes).sort((a, b) => a.path.localeCompare(b.path)).map(page => this.button(`page-${page.path}`, page.name, cx => this.open(page.path, cx))),
    ]));
    const body: Element[] = [];
    if (!session.initialized && !session.error) body.push(text('这个仓库还没有初始化 Concord'), this.button('initialize', '在这里初始化 Concord', cx => this.run(cx, session.initialize(), current => this.watch(current))));
    if (this.creating && this.name && this.title) body.push(Input.new(this.name).id('feature-name'), Input.new(this.title).id('feature-title'), this.button('create-feature', '创建 Feature', cx => this.run(cx, session.createFeature(this.name!.value(), this.title!.value()), current => { this.creating = false; this.edit(current); })));
    if (session.check) body.push(text(session.check.ok ? 'check: ok' : `check: ${session.check.findings.length} 个问题`), ...session.check.findings.map((finding, index) => this.button(`finding-${index}`, `${finding.path}:${finding.line ?? 1}  ${finding.message}`, cx => this.location(finding.path, finding.line ?? 1, cx))));
    if (session.selected) {
      body.push(text(session.selected));
      if (session.deleted) body.push(text('这页已被删除'));
      if (session.conflict) body.push(text('文件已变化；草稿已保留。'), this.button('merge', '查看磁盘版本并重新合并', cx => this.run(cx, Effect.tryPromise(async () => {
        const disk = await readTextFile(`${session.root}/${session.selected!}`);
        if (disk === null) return;
        this.preview?.release(); this.preview = EditorState.new({ language: 'markdown', value: disk, readonly: true }); this.previewLabel = '磁盘版本；请在草稿中合并';
        // Explicit merge begins from the newly read disk preimage, retaining the editor.
        const draft = this.editor?.value(); session.draft = undefined;
        await runEffect(session.open(session.selected!, false)); session.draft = draft;
      }))));
      if (this.editor) body.push(h_flex().gap(6).children([
        this.button('save', '保存并检查', cx => this.run(cx, session.save(this.editor!.value()), () => { this.editor?.release(); this.editor = undefined; })),
        this.button('discard', '放弃修改', cx => this.open(session.selected!, cx)),
      ]), Editor.new(this.editor).id('document-editor').flex_1());
      else if (!session.deleted) body.push(this.button('edit', '编辑', cx => this.edit(cx)), TextView.markdown(`concord-body-${session.selected}`, session.source).on_link_click((url, cx) => this.link(url, cx)));
      const tests = session.detail.tests ?? [], codes = session.detail.codeDeclarations ?? [];
      const references = [...new Set([...tests.map(item => item.contract), ...codes.flatMap(item => item.contracts)].filter(ref => ref === session.selected || ref.startsWith(`${session.selected}#`)))];
      for (const ref of references) body.push(text(ref.includes('#') ? `步骤：${ref.split('#')[1]}` : '整页关联'), text('测试'), ...tests.filter(item => item.contract === ref).map((item, index) => this.button(`test-${ref}-${index}`, `${item.file}:${item.line}  ${item.name}`, cx => this.location(item.file, item.line, cx))), text('实现'), ...codes.filter(item => item.contracts.includes(ref)).map((item, index) => this.button(`code-${ref}-${index}`, `${item.file}:${item.line}  ${item.symbol ?? ref}`, cx => this.location(item.file, item.line, cx))));
    }
    if (this.conceptText) body.push(this.button('close-concept', '关闭术语定义', cx => { this.conceptText = undefined; cx.notify(); }), TextView.markdown('concord-concept', this.conceptText));
    if (this.preview) body.push(text(this.previewLabel), this.button('close-preview', '关闭源码', cx => { this.preview?.release(); this.preview = undefined; cx.notify(); }), Editor.new(this.preview));
    return v_flex().id('concord-mod').size_full().min_w(0).min_h(0).p(10).gap(8).bg(color('surface')).text_color(color('foreground')).text_size(13).children([
      toolbar, status, h_flex().flex_1().min_h(0).gap(10).children([navigation, v_flex().id(`concord-document-${session.selected ?? 'none'}`).flex_1().min_w(0).min_h(0).overflow_y_scroll().gap(6).children(body)]),
    ]);
  }

  close(_cx: Context): void {
    this.session.stop();
    this.watcher?.cancel(); this.debounce?.cancel();
    for (const task of this.tasks) task.cancel();
    this.tasks.clear();
    this.editor?.release(); this.preview?.release(); this.name?.release(); this.title?.release();
  }
}
