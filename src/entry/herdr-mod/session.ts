// @concord-file
// @concord-implements docs/feature/herdr-mod/architecture.md#数据
// @concord-implements docs/feature/herdr-mod/use-case/init-from-herdr.md#guide
// @concord-implements docs/feature/project-onboarding/use-case/start-writing-specs.md#guide
// @concord-implements docs/feature/herdr-mod/use-case/use-on-remote-machine.md
import { Context, Effect, Schema } from 'effect';
import { ModWorkspaceProjection, ModWorkspaceSnapshot, RenderedPage, WorkspaceWait, pageSource, type PageSource } from '../../model/herdr-mod/index.ts';

export interface ModHost {
  readonly exec: (command: string, args: string[], options: { cwd?: string; on: string | null }) => Promise<{ code: number; stdout: string; stderr: string }>;
}
export class ModFailure extends Schema.TaggedError<ModFailure>()('ModFailure', { message: Schema.String, code: Schema.optional(Schema.String), details: Schema.optional(Schema.String) }) {}
export class ModDisconnected extends Schema.TaggedError<ModDisconnected>()('ModDisconnected', { machine: Schema.String }) {}
export const failure = (cause: unknown) => cause instanceof ModFailure ? cause : new ModFailure({ message: 'Concord 命令失败', details: cause instanceof Error ? cause.message : String(cause) });
export const isCliMissing = (error: ModFailure) => /(?:cannot|unable to|failed to) (?:start|spawn|execute|run) ['"]?(?:[^\s'"]*\/)?concord['"]?(?:\s|:|$)|(?:spawn|spawnSync|exec) (?:[^\s]*\/)?concord(?:\s|:).*?(?:ENOENT|not found)|(?:^|[\s:])(?:[^\s:]*\/)?concord:? (?:command )?not found|command not found: (?:[^\s]*\/)?concord(?:\s|$)/iu.test(`${error.message} ${error.details ?? ''}`);
const io = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: failure });
const remotePreparation = Context.Reference<{ session: ModSession; prepare: Effect.Effect<void, ModFailure | ModDisconnected> } | undefined>('concord/entry/herdr-mod/RemotePreparation', { defaultValue: () => undefined });
const Path = Schema.String.check(Schema.isPattern(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)[^\u0000]+$/u));
const Owner = Schema.Struct({ path: Path, kind: Schema.String, title: Schema.String, feature: Schema.optional(Schema.String) });
const Page = Schema.Struct({ path: Path, kind: Schema.String, name: Schema.String });
const Case = Schema.Struct({ file: Path, line: Schema.Int, name: Schema.String, contract: Schema.String });
const Code = Schema.Struct({ file: Path, line: Schema.Int, symbol: Schema.optional(Schema.String), contracts: Schema.Array(Schema.String) });
const Show = Schema.Struct({ tests: Schema.optional(Schema.Array(Case)), codeDeclarations: Schema.optional(Schema.Array(Code)), pages: Schema.optional(Schema.Array(Page)) });
const Check = Schema.Struct({ ok: Schema.Boolean, findings: Schema.Array(Schema.Struct({ path: Schema.String, line: Schema.optional(Schema.Int), message: Schema.String })) });
const Initialization = Schema.Struct({ createdPaths: Schema.Array(Path) });
const ErrorReply = Schema.Struct({ error: Schema.String, message: Schema.String });
const ServerStatus = Schema.Union([
  Schema.Struct({ state: Schema.Literal('absent') }),
  Schema.Struct({ state: Schema.Literals(['opening', 'running', 'degraded', 'draining', 'clearing', 'blocked', 'stopping']), compatible: Schema.Boolean, token: Schema.String }),
]);
const File = Schema.Struct({ path: Path, body: Schema.String, digest: Schema.String });
export type ModPage = typeof Page.Type;
export type ModCheck = typeof Check.Type;
export type ModDetail = typeof Show.Type;
export type ModConcept = { readonly reference: string; readonly path: string; readonly concept: typeof ModWorkspaceSnapshot.Type['conceptCatalogs'][number]['concepts'][number] };

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
  private snapshot: typeof ModWorkspaceSnapshot.Type | undefined;
  documents: readonly (typeof Owner.Type)[] = [];
  pages: readonly ModPage[] = [];
  concepts: readonly ModConcept[] = [];
  selected: string | undefined;
  source = '';
  sourcePage: PageSource = { blocks: [{ start: 0, end: 0, literal: false }], special: [], definitions: '' };
  draft: string | undefined;
  sourceDigest = '';
  workspaceDigest: string | undefined;
  reloadVersion = 0;
  saving = false;
  saveFailed = false;
  checking = false;
  checkFailed = false;
  checkGeneration = 0;
  checkPending = false;
  reconnecting = false;
  deleted = false;
  error = '';
  errorDetails = '';
  errorCode = '';
  /** The first read of this repository has finished; later reads keep the current view until they finish. */
  loaded = false;
  detail: ModDetail = {};
  check: ModCheck | undefined;
  private rootResolved = false;
  closed = false;
  private observation = {};
  private selection = {};
  /** The selection token that `selected` belongs to; a newer click owns a newer token. */
  private selectedToken = {};
  private fileObservation = 0;
  private savingBody: string | undefined;
  readonly host: ModHost;
  readonly machine: string | null;
  constructor(host: ModHost, cwd: string, machine: string | null = null) { this.host = host; this.root = cwd; this.machine = machine; }

  private io<A>(run: () => Promise<A>) {
    return io(run).pipe(Effect.mapError(error => this.machine === null || isCliMissing(error) ? error : new ModDisconnected({ machine: this.machine })));
  }

  /** Nested reads share this operation's preparation; independent fibers never share it. */
  private prepareOperation<A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E> {
    if (this.machine === null) return effect;
    return Effect.gen({ self: this }, function*() {
      const existing = yield* remotePreparation;
      if (existing?.session === this) return yield* effect;
      const prepare = yield* Effect.cached(this.ensureRemoteService());
      return yield* effect.pipe(Effect.provideService(remotePreparation, { session: this, prepare }));
    });
  }

  readFile(path: string) {
    return this.command(actionArgs({ action: 'file.get', path }), File).pipe(Effect.catch(error => error instanceof ModFailure && (error.code === 'FileNotFound' || error.code === 'ProjectNotInitialized') ? Effect.succeed(undefined) : Effect.fail(error)));
  }
  read(path: string) { return this.readFile(path).pipe(Effect.map(file => file?.body ?? null)); }

  setDraft(body: string): void { this.draft = body === this.source ? undefined : body; }

  private acceptFile(file: typeof File.Type | undefined, reset: boolean): void {
    const body = file?.body ?? '';
    // File acceptance runs in the read/save task, outside the host's render budget.
    if (body !== this.source) this.sourcePage = pageSource(body);
    if (reset || (file?.digest !== this.sourceDigest && body !== this.savingBody)) {
      this.draft = undefined; this.reloadVersion += 1;
    }
    this.source = body; this.sourceDigest = file?.digest ?? ''; this.deleted = file === undefined;
  }

  renderPage(path: string, theme: Readonly<Record<string, string>>) {
    return this.command(actionArgs({ action: 'page.render', path, theme }), Schema.Unknown).pipe(
      Effect.flatMap(value => Schema.decodeUnknownEffect(RenderedPage, { onExcessProperty: 'error' })(value).pipe(Effect.mapError(failure))),
    );
  }

  command<S extends Schema.Top & { readonly DecodingServices: never }>(args: readonly string[], schema: S, diagnostic = false) {
    return Effect.gen({ self: this }, function*() {
      const remoteService = this.machine !== null && args[0] !== 'server' && args[0] !== 'init';
      if (remoteService) {
        const prepared = yield* remotePreparation;
        yield* prepared?.session === this ? prepared.prepare : this.ensureRemoteService();
      }
      const reply = yield* this.io(() => this.host.exec('concord', ['--json', ...(remoteService ? ['--server=existing'] : []), '--root', this.root, ...args], { cwd: this.root, on: this.machine }));
      if (reply.code !== 0) {
        const details = [reply.stderr, reply.stdout].filter(Boolean).join('\n');
        for (const output of [reply.stderr, reply.stdout]) {
          // Cache warnings and process diagnostics can accompany a JSON error.
          for (const candidate of [output, ...output.trim().split('\n').reverse()]) {
            const error = Schema.decodeUnknownExit(Schema.fromJsonString(ErrorReply), { onExcessProperty: 'ignore' })(candidate);
            if (error._tag === 'Success') return yield* Effect.fail(new ModFailure({ message: error.value.message, code: error.value.error, details }));
          }
        }
        if (!diagnostic || !reply.stdout.trim()) return yield* Effect.fail(new ModFailure({ message: 'Concord 命令失败', details }));
      }
      const value = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(schema), { onExcessProperty: 'ignore' })(reply.stdout).pipe(Effect.mapError(failure));
      return value;
    });
  }

  refresh = (notify: (error?: ModFailure) => void = () => {}) => this.prepareOperation(this.refreshOperation(notify));

  private refreshOperation = Effect.fn('ModSession.refresh')(function*(this: ModSession, notify: (error?: ModFailure) => void): Effect.fn.Return<void, ModFailure | ModDisconnected> {
    const observation = this.observation = {};
    const current = () => !this.closed && observation === this.observation;
    const selected = this.selected;
    // Pair the shown page with its own token, so a page being opened now is not replaced by the older one.
    const selection = this.selectedToken;
    type Observation = { snapshot: typeof ModWorkspaceSnapshot.Type; projection: typeof ModWorkspaceProjection.Type['projection'] | undefined } | undefined;
    const readProjection = Effect.gen({ self: this }, function*(): Effect.fn.Return<Observation, ModFailure | ModDisconnected> {
      for (let attempt = 0; current(); attempt++) {
        const reply = yield* Effect.result(this.command(['workspace', 'projection'], ModWorkspaceProjection));
        if (reply._tag === 'Success') return reply.success;
        if (!(reply.failure instanceof ModFailure) || reply.failure.code !== 'WorkspaceProjectionPending') return yield* Effect.fail(reply.failure);
        notify(reply.failure);
        if (attempt === 2) return yield* Effect.fail(reply.failure);
        const waited = yield* Effect.result(this.waitForWorkspace());
        if (waited._tag === 'Failure' && (!(waited.failure instanceof ModFailure) || waited.failure.code !== 'WorkspaceProjectionPending')) return yield* Effect.fail(waited.failure);
      }
    });
    const result = yield* readProjection.pipe(
      Effect.catch((error): Effect.Effect<Observation, ModFailure | ModDisconnected> => {
        if (!(error instanceof ModFailure)) return Effect.fail(error);
        if (error.code === 'ProjectNotInitialized') return Effect.succeed(undefined);
        if (error.code === 'WorkspaceProjectionUnavailable' || error.code?.startsWith('Hawdb')) return this.command(['workspace', 'show'], ModWorkspaceSnapshot).pipe(
          Effect.map(snapshot => ({ snapshot, projection: undefined })));
        return Effect.fail(error);
      }));
    if (!current()) return;
    this.rootResolved = true;
    this.loaded = true;
    this.initialized = result !== undefined;
    if (!result) {
      this.documents = []; this.pages = []; this.concepts = []; this.detail = {}; this.snapshot = undefined; this.workspaceDigest = undefined;
      this.error = ''; this.errorCode = '';
      notify(); return;
    }
    const { snapshot, projection } = result;
    const changed = !projection || projection.sourceDigest !== this.workspaceDigest;
    if (changed) {
      this.snapshot = snapshot;
      this.root = snapshot.root;
      this.workspaceDigest = projection?.sourceDigest;
      this.documents = snapshot.documents.map(({ path, metadata }) => ({ path, ...metadata }));
      const owners = new Map(this.documents.map(owner => [owner.path, owner]));
      this.pages = snapshot.pages.map(page => ({ path: page.path, kind: owners.get(page.path)?.kind ?? 'page', name: page.derivedTitle ?? owners.get(page.path)?.title ?? page.path }));
      this.concepts = snapshot.conceptCatalogs.flatMap(catalog => catalog.concepts.map(concept => ({ path: catalog.path, reference: `${catalog.path}#${concept.id}`, concept })));
      if (!this.checking && !this.checkFailed) this.check = { ok: snapshot.findings.length === 0, findings: snapshot.findings };
      this.detail = this.detailFor(this.selected);
      notify();
    }
    if (selected && changed) yield* this.open(selected, false, selection, () => { if (current()) notify(); });
    this.error = ''; this.errorCode = '';
  });

  private detailFor(path: string | undefined): ModDetail {
    const matches = (reference: string) => reference === path || reference.startsWith(`${path}#`);
    return { tests: this.snapshot?.cases.filter(item => matches(item.contract)), codeDeclarations: this.snapshot?.codes.filter(item => item.contracts.some(matches)) };
  }

  open = (path: string, resetDraft = true, expectedSelection = this.selection, notify: () => void = () => {}) => this.prepareOperation(this.openOperation(path, resetDraft, expectedSelection, notify));

  private openOperation = Effect.fn('ModSession.open')(function*(this: ModSession, path: string, resetDraft: boolean, expectedSelection: object, notify: () => void): Effect.fn.Return<void, ModFailure | ModDisconnected> {
    const canonical = yield* Schema.decodeUnknownEffect(Path)(path).pipe(Effect.mapError(failure));
    if (!resetDraft && expectedSelection !== this.selection) return;
    const token = resetDraft ? this.selection = {} : expectedSelection;
    if (!this.rootResolved) {
      yield* this.refresh();
      if (this.closed || token !== this.selection) return;
    }
    const observation = ++this.fileObservation;
    const file = yield* this.readFile(canonical);
    if (this.closed || token !== this.selection || observation !== this.fileObservation) return;
    this.selected = canonical; this.selectedToken = token;
    this.acceptFile(file, resetDraft);
    notify();
    if (resetDraft && canonical === 'docs/taste.md') yield* this.command(['taste'], Schema.Unknown);
    if (!this.closed && token === this.selection) this.detail = this.detailFor(canonical);
  });

  save = (body?: string, notify: () => void = () => {}) => this.prepareOperation(this.saveOperation(body, notify));

  private saveOperation = Effect.fn('ModSession.save')(function*(this: ModSession, body: string | undefined, notify: () => void) {
    if (body !== undefined) this.setDraft(body);
    if (!this.selected || this.draft === undefined || this.closed || this.saving) return;
    const path = this.selected, draft = this.draft, selection = this.selection, version = this.reloadVersion;
    const current = () => !this.closed && selection === this.selection && version === this.reloadVersion;
    this.saving = true; this.savingBody = draft; this.saveFailed = false;
    notify();
    this.fileObservation += 1;
    yield* Effect.gen({ self: this }, function*() {
      for (let attempt = 0; attempt < 3; attempt++) {
        const file = yield* this.readFile(path);
        if (!current()) return;
        if (!file) { this.acceptFile(undefined, false); return; }
        const write = yield* Effect.result(this.command(actionArgs({ action: 'document.set', path, body: draft, expectedDigest: file.digest }), Schema.Unknown));
        if (!current()) return;
        if (write._tag === 'Failure') {
          if (write.failure instanceof ModFailure && write.failure.code === 'FileChangedSinceRead' && attempt < 2) continue;
          return yield* Effect.fail(write.failure);
        }
        const observation = ++this.fileObservation;
        const confirmed = yield* this.readFile(path);
        if (!current() || observation !== this.fileObservation) return;
        this.acceptFile(confirmed, false);
        if (this.draft === draft) this.draft = undefined;
        if (!current()) return;
        this.checkGeneration += 1; this.checkPending = true;
        this.checking = true; this.check = undefined; this.checkFailed = false;
        this.error = ''; this.errorCode = ''; this.errorDetails = '';
        return;
      }
    }).pipe(Effect.onError(() => Effect.sync(() => { if (current()) this.saveFailed = true; })), Effect.ensuring(Effect.sync(() => {
      this.saving = false; this.savingBody = undefined; notify();
    })));
  });

  initialize = Effect.fn('ModSession.initialize')(function*(this: ModSession, notify: (error?: ModFailure) => void = () => {}) {
    const receipt = yield* this.command(['init'], Initialization);
    if (this.closed) return;
    this.initialization = receipt;
    this.initialized = true; this.loaded = true;
    notify();
    yield* this.refresh(notify).pipe(Effect.mapError(error => error instanceof ModFailure
      ? new ModFailure({ message: `初始化已完成，读取文档失败：${error.message}`, code: error.code, details: error.details }) : error));
  });

  initializationRequest(location: string): string {
    return `${location} 刚初始化了 Concord。\n请运行 concord --skill start，结合我的需求和仓库现状，参照 docs 目录树与文档示例编写 Spec。`;
  }

  suspend(): void { this.observation = {}; this.fileObservation += 1; }

  checkNow = Effect.fn('ModSession.checkNow')(function*(this: ModSession) {
    if (this.closed || !this.checkPending) return;
    const generation = this.checkGeneration;
    this.checkPending = false; this.checking = true;
    yield* Effect.gen({ self: this }, function*() {
      const result = yield* Effect.result(this.command(['check'], Check, true));
      if (this.closed || generation !== this.checkGeneration) return;
      if (result._tag === 'Failure') { this.checkFailed = true; return yield* Effect.fail(result.failure); }
      this.check = result.success; this.checkFailed = false;
    }).pipe(Effect.ensuring(Effect.sync(() => { this.checking = !this.closed && this.checkPending; })));
  });

  private ensureRemoteService = Effect.fn('ModSession.ensureRemoteService')(function*(this: ModSession): Effect.fn.Return<void, ModFailure | ModDisconnected> {
    let status = yield* this.command(['server', 'status'], ServerStatus);
    if (status.state !== 'absent' && !status.compatible) {
      yield* this.command(['server', 'stop', '--token', status.token], Schema.Unknown);
      status = yield* this.command(['server', 'status'], ServerStatus);
    }
    if (status.state === 'absent') {
      // A remote exec reclaims detached children. Transfer the foreground
      // service to its own core terminal instead of escaping the exec scope.
      const started = yield* io(() => this.host.exec('hc', ['run', '--on', this.machine!, '--cwd', this.root, '--bg', '--no-parent', '--rm', '--', 'concord', 'server', 'run', '--root', this.root], { on: null })).pipe(
        Effect.mapError(error => new ModFailure({ code: 'HerdrServiceStartFailed', message: 'Herdr 无法启动 Concord 工作区服务', details: error.details })),
      );
      if (started.code !== 0) return yield* Effect.fail(new ModFailure({ code: 'HerdrServiceStartFailed', message: 'Herdr 无法启动 Concord 工作区服务', details: [started.stderr, started.stdout].filter(Boolean).join('\n') }));
      // A terminal receipt precedes the service lock; require a compatible
      // handshake before the business command, which cannot start a service.
      status = yield* this.command(['server', 'status', '--wait'], ServerStatus);
    }
    if (status.state === 'absent') return yield* Effect.fail(new ModFailure({ code: 'WorkspaceServerUnavailable', message: 'Concord 工作区服务尚未启动' }));
    if (!status.compatible) return yield* Effect.fail(new ModFailure({ code: 'WorkspaceServerBusy', message: '另一个 Concord 安装正在使用这个仓库', details: JSON.stringify(status) }));
  });

  private waitForWorkspace = Effect.fn('ModSession.waitForWorkspace')(function*(this: ModSession, after?: string) {
    return yield* this.command(['workspace', 'wait', ...(after === undefined ? [] : ['--after', after])], WorkspaceWait);
  });

  wait = Effect.fn('ModSession.wait')(function*(this: ModSession) { return yield* this.waitForWorkspace(this.workspaceDigest); });

  stop(): void { this.closed = true; this.checkPending = false; this.checking = false; this.checkGeneration += 1; this.observation = {}; this.selection = {}; }
}
