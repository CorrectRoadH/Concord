// @concord-file
// @concord-implements docs/feature/herdr-mod/architecture.md#数据
// @concord-implements docs/feature/herdr-mod/use-case/init-from-herdr.md#guide
// @concord-implements docs/feature/project-onboarding/use-case/start-writing-specs.md#guide
// @concord-implements docs/feature/project-onboarding/use-case/start-writing-specs.md#read-guide
// @concord-implements docs/feature/herdr-mod/use-case/use-on-remote-machine.md
import { Effect, Schema } from 'effect';
import { RenderedPage, WorkspaceWait } from '../../model/herdr-mod/index.ts';

export interface ModHost {
  readonly exec: (command: string, args: string[], options: { cwd: string; on: string | null }) => Promise<{ code: number; stdout: string; stderr: string }>;
}
export class ModFailure extends Schema.TaggedError<ModFailure>()('ModFailure', { message: Schema.String, code: Schema.optional(Schema.String), details: Schema.optional(Schema.String) }) {}
export class ModDisconnected extends Schema.TaggedError<ModDisconnected>()('ModDisconnected', { machine: Schema.String }) {}
export const failure = (cause: unknown) => cause instanceof ModFailure ? cause : new ModFailure({ message: 'Concord 命令失败', details: cause instanceof Error ? cause.message : String(cause) });
const io = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: failure });
const Path = Schema.String.check(Schema.isPattern(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)[^\u0000]+$/u));
const Owner = Schema.Struct({ path: Path, kind: Schema.String, title: Schema.String, feature: Schema.optional(Schema.String) });
const Page = Schema.Struct({ path: Path, kind: Schema.String, name: Schema.String });
const Case = Schema.Struct({ file: Path, line: Schema.Int, name: Schema.String, contract: Schema.String });
const Code = Schema.Struct({ file: Path, line: Schema.Int, symbol: Schema.optional(Schema.String), contracts: Schema.Array(Schema.String) });
const Show = Schema.Struct({ tests: Schema.optional(Schema.Array(Case)), codeDeclarations: Schema.optional(Schema.Array(Code)), pages: Schema.optional(Schema.Array(Page)) });
const Doctor = Schema.Struct({ root: Schema.String, configuration: Schema.Struct({ sourceRoots: Schema.optional(Schema.Array(Schema.String)), testRoots: Schema.optional(Schema.Array(Schema.String)) }) });
const Concepts = Schema.Struct({ concepts: Schema.Array(Schema.Struct({ reference: Schema.String, path: Path, concept: Schema.Struct({ id: Schema.String, term: Schema.String, definition: Schema.optional(Schema.String) }) })), catalogs: Schema.Array(Schema.Struct({ path: Path })) });
const Check = Schema.Struct({ ok: Schema.Boolean, findings: Schema.Array(Schema.Struct({ path: Schema.String, line: Schema.optional(Schema.Int), message: Schema.String })) });
const Initialization = Schema.Struct({ createdPaths: Schema.Array(Path), guide: Schema.Literals(['docs-from-scratch', 'docs-from-code']) });
const ErrorReply = Schema.Struct({ error: Schema.String, message: Schema.String });
const File = Schema.Struct({ path: Path, body: Schema.String, digest: Schema.String });
export type ModPage = typeof Page.Type;
export type ModCheck = typeof Check.Type;
export type ModDetail = typeof Show.Type;
export type ModConcept = typeof Concepts.Type['concepts'][number];
export const fixedPages = ['docs/README.md', 'docs/architecture.md', 'docs/document-model.md', 'docs/taste.md', 'docs/concepts.md', 'docs/writing.md'] as const;

/** Bound each argument by its UTF-8 size, including non-ASCII drafts. */
export function actionArgs(input: unknown): string[] {
  const args = ['action'];
  let chunk = '', bytes = 0;
  for (const character of JSON.stringify(input)) {
    const point = character.codePointAt(0)!;
    const size = point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
    if (bytes + size > 64 * 1024 - '--input-text='.length) { args.push(`--input-text=${chunk}`); chunk = ''; bytes = 0; }
    chunk += character; bytes += size;
  }
  args.push(`--input-text=${chunk}`);
  return args;
}

export function markdownTarget(current: string, target: string): string | undefined {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/|\\)/iu.test(target)) return;
  const [file] = target.split('#');
  if (!file) return current;
  const parts = current.split('/').slice(0, -1);
  for (const part of file.split('/')) {
    if (part === '..') { if (!parts.length) return; parts.pop(); }
    else if (part && part !== '.') parts.push(part);
  }
  const path = parts.join('/');
  return /\.(?:md|mdx)$/u.test(path) ? path : undefined;
}

/** All product observations and writes use the public CLI on the selected machine. */
export class ModSession {
  root: string;
  initialized = false;
  initialization: typeof Initialization.Type | undefined;
  guideSource: string | undefined;
  documents: readonly (typeof Owner.Type)[] = [];
  pages: readonly ModPage[] = [];
  concepts: readonly ModConcept[] = [];
  selected: string | undefined;
  source = '';
  draft: string | undefined;
  sourceDigest = '';
  workspaceDigest: string | undefined;
  conflict = false;
  deleted = false;
  error = '';
  errorDetails = '';
  detail: ModDetail = {};
  check: ModCheck | undefined;
  private rootResolved = false;
  closed = false;
  private observation = {};
  private selection = {};
  readonly host: ModHost;
  readonly machine: string | null;
  constructor(host: ModHost, cwd: string, machine: string | null = null) { this.host = host; this.root = cwd; this.machine = machine; }

  private io<A>(run: () => Promise<A>) {
    return io(run).pipe(Effect.mapError(error => this.machine === null ? error : new ModDisconnected({ machine: this.machine })));
  }

  readFile(path: string) {
    return this.command(actionArgs({ action: 'file.get', path }), File).pipe(Effect.catch(error => error instanceof ModFailure && (error.code === 'FileNotFound' || error.code === 'ProjectNotInitialized') ? Effect.succeed(undefined) : Effect.fail(error)));
  }
  read(path: string) { return this.readFile(path).pipe(Effect.map(file => file?.body ?? null)); }

  renderPage(path: string, theme: Readonly<Record<string, string>>) {
    return this.command(actionArgs({ action: 'page.render', path, theme }), Schema.Unknown).pipe(
      Effect.flatMap(value => Schema.decodeUnknownEffect(RenderedPage, { onExcessProperty: 'error' })(value).pipe(Effect.mapError(failure))),
    );
  }

  command<S extends Schema.Top & { readonly DecodingServices: never }>(args: readonly string[], schema: S, diagnostic = false, discoverRoot = false) {
    return Effect.gen({ self: this }, function*() {
      const reply = yield* this.io(() => this.host.exec('concord', ['--json', '--fresh', ...(discoverRoot ? [] : ['--root', this.root]), ...args], { cwd: this.root, on: this.machine }));
      if (reply.code !== 0) {
        const error = Schema.decodeUnknownExit(Schema.fromJsonString(ErrorReply), { onExcessProperty: 'ignore' })(reply.stderr || reply.stdout);
        if (error._tag === 'Success') return yield* Effect.fail(new ModFailure({ message: error.value.message, code: error.value.error }));
        if (!diagnostic || !reply.stdout.trim()) return yield* Effect.fail(new ModFailure({ message: 'Concord 命令失败', details: reply.stderr || reply.stdout }));
      }
      return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(schema), { onExcessProperty: 'ignore' })(reply.stdout).pipe(Effect.mapError(failure));
    });
  }

  refresh = Effect.fn('ModSession.refresh')(function*(this: ModSession, notify: () => void = () => {}) {
    const observation = this.observation = {};
    const current = () => !this.closed && observation === this.observation;
    const selected = this.selected;
    const selection = this.selection;
    // A pane can start below the Git top. Without a local marker, let the public
    // doctor discover that top before sending any initialization-guarded query.
    let doctor: typeof Doctor.Type | undefined;
    let taste = yield* this.read('docs/taste.md');
    if (!current()) return;
    if (taste === null) {
      const before = this.root;
      doctor = yield* this.command(['doctor'], Doctor, true, true);
      if (!current()) return;
      this.root = doctor.root;
      if (this.root !== before) taste = yield* this.read('docs/taste.md');
      if (!current()) return;
    }
    this.initialized = taste !== null;
    if (!this.initialized) {
      this.documents = []; this.pages = []; this.concepts = []; this.detail = {};
      this.rootResolved = true;
      this.error = '';
      notify();
      return;
    }
    const [resolvedDoctor] = yield* Effect.all([
      doctor ? Effect.succeed(doctor) : this.command(['doctor'], Doctor, true),
      this.command(['list'], Schema.Struct({ documents: Schema.Array(Owner) })).pipe(Effect.tap(reply => Effect.sync(() => {
        if (!current()) return;
        this.documents = reply.documents;
        notify(); // The first readable Feature list need not wait for concepts or package details.
      }))),
      selected ? this.open(selected, false, selection, () => { if (current()) notify(); }) : Effect.void,
    ], { concurrency: 'unbounded' });
    if (!current()) return;
    this.root = resolvedDoctor.root;
    this.rootResolved = true;
    const fixed = yield* Effect.forEach(fixedPages, path => this.read(path).pipe(Effect.map(source => source === null ? undefined : { path, kind: path === 'docs/taste.md' ? 'taste' : path.endsWith('/concepts.md') ? 'concepts' : 'page', name: /^#\s+(.+)$/mu.exec(source)?.[1] ?? path })), { concurrency: 'unbounded' });
    if (!current()) return;
    this.pages = fixed.filter((page): page is NonNullable<typeof page> => page !== undefined);
    notify();
    // Details are derived again on every refresh, never saved as a second registry.
    const [concepts, packages] = yield* Effect.all([
      this.command(['concepts', 'index'], Concepts),
      Effect.forEach(this.documents.filter(owner => ['feature', 'engineering', 'roadmap'].includes(owner.kind)), owner => this.command(['show', owner.path], Show), { concurrency: 4 }),
      this.command(['taste'], Schema.Unknown).pipe(Effect.catch(error => error instanceof ModDisconnected ? Effect.fail(error) : Effect.succeed(undefined))),
    ], { concurrency: 'unbounded' });
    if (!current()) return;
    this.concepts = concepts.concepts;
    const catalogPages = concepts.catalogs.map(catalog => ({ path: catalog.path, kind: 'concepts', name: catalog.path }));
    this.pages = [...new Map([...this.pages, ...catalogPages, ...packages.flatMap(pkg => pkg.pages ?? [])].map(page => [page.path, page])).values()].sort((a, b) => a.path.localeCompare(b.path));
    this.error = '';
    notify();
  });

  open = Effect.fn('ModSession.open')(function*(this: ModSession, path: string, resetDraft = true, expectedSelection = this.selection, notify: () => void = () => {}) {
    const canonical = yield* Schema.decodeUnknownEffect(Path)(path).pipe(Effect.mapError(failure));
    if (!resetDraft && expectedSelection !== this.selection) return;
    const token = resetDraft ? this.selection = {} : expectedSelection;
    if (!this.rootResolved) {
      const doctor = yield* this.command(['doctor'], Doctor, true);
      if (this.closed || token !== this.selection) return;
      this.root = doctor.root;
      this.rootResolved = true;
    }
    const file = yield* this.readFile(canonical);
    const source = file?.body ?? null;
    if (this.closed || token !== this.selection) return;
    if (resetDraft) this.draft = undefined;
    this.selected = canonical;
    this.deleted = source === null;
    if (this.draft !== undefined) this.conflict = source !== this.source;
    else { this.source = source ?? ''; this.sourceDigest = file?.digest ?? ''; this.conflict = false; }
    notify();
    if (source !== null) {
      const links = [...source.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)/gu)].flatMap(match => {
        const target = markdownTarget(canonical, match[1]!);
        return target ? [{ path: target, kind: 'page', name: target }] : [];
      });
      this.pages = [...new Map([...this.pages, ...links].map(page => [page.path, page])).values()];
    }
    const belongs = this.documents.some(owner => owner.path === canonical) || this.pages.some(page => page.path === canonical && !fixedPages.includes(canonical as typeof fixedPages[number]));
    const detail = belongs ? yield* this.command(['show', canonical], Show).pipe(Effect.catch(error => error instanceof ModDisconnected ? Effect.fail(error) : Effect.succeed({} as ModDetail))) : {};
    if (!this.closed && token === this.selection) this.detail = detail;
  });

  save = Effect.fn('ModSession.save')(function*(this: ModSession, draft: string) {
    if (!this.selected) return;
    const path = this.selected;
    this.draft = draft;
    yield* this.command(actionArgs({ action: 'document.set', path, body: draft, expectedDigest: this.sourceDigest }), Schema.Unknown).pipe(Effect.tapError(error => Effect.sync(() => {
      if (error instanceof ModFailure && error.code === 'FileChangedSinceRead') this.conflict = true;
    })));
    if (this.closed || this.selected !== path) return;
    this.draft = undefined; this.conflict = false;
    yield* this.open(path, false);
    this.check = yield* this.command(['check'], Check, true);
  });

  initialize = Effect.fn('ModSession.initialize')(function*(this: ModSession) {
    const receipt = yield* this.command(['init'], Initialization);
    if (this.closed) return;
    this.initialization = receipt;
    yield* this.refresh();
  });

  readGuide = Effect.fn('ModSession.readGuide')(function*(this: ModSession) {
    const guide = this.initialization?.guide;
    if (!guide) return;
    const reply = yield* this.io(() => this.host.exec('concord', ['--skill', guide], { cwd: this.root, on: this.machine }));
    if (reply.code !== 0) return yield* Effect.fail(new ModFailure({ message: 'Concord 命令失败', details: reply.stderr || reply.stdout }));
    const source = yield* Schema.decodeUnknownEffect(Schema.NonEmptyString)(reply.stdout).pipe(Effect.mapError(failure));
    if (!this.closed && this.initialization?.guide === guide) this.guideSource = source;
  });

  createFeature = Effect.fn('ModSession.createFeature')(function*(this: ModSession, name: string, title: string) {
    const receipt = yield* this.command(['new', 'feature', name, '--title', title || name], Schema.Struct({ changedPaths: Schema.Array(Path) }));
    yield* this.refresh();
    const path = receipt.changedPaths.find(path => path.endsWith('/README.md'));
    if (path) yield* this.open(path);
  });

  checkNow = Effect.fn('ModSession.checkNow')(function*(this: ModSession) { this.check = yield* this.command(['check'], Check, true); });

  wait = Effect.fn('ModSession.wait')(function*(this: ModSession) {
    return yield* this.command(['workspace', 'wait', ...(this.workspaceDigest === undefined ? [] : ['--after', this.workspaceDigest])], WorkspaceWait);
  });

  stop(): void { this.closed = true; this.observation = {}; this.selection = {}; }
}
