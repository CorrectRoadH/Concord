// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/analyze-other-languages.md
import { pathToFileURL } from 'node:url';
import { Effect, Fiber, Predicate, Schema } from 'effect';
import { ConcordError, decode, failure, objectDigest, type AnnotatedCase, type Repository } from './shared.js';
import { OwnedProcess, hasConfirmedOwnedGroupCleanup, type OwnedProcessResult } from './owned-process.js';
import { analysisBudgets, type LanguageServer } from './language-server-config.js';
import { LspConnection } from './lsp-protocol.js';
import { bindSymbol, CallItemSchema, documentSymbols, flattenSymbols, OutgoingSchema, PrepareSchema, sourceUri, uriPath, validRange, type CallItem, type DocumentSymbol, type PositionEncoding, type SymbolLocator } from './lsp-symbols.js';
import type { CodeDeclaration } from './code.js';
import type { AnalysisValue, DependencyObservation, NativeAnalysisScope } from './analysis-values.js';
import { withinRoots } from './typescript-dependencies.js';

const sync = <A>(run: () => A) => Effect.try({ try: run, catch: cause => cause instanceof ConcordError && cause.code === 'InvalidData' ? new ConcordError('LanguageServerFailed', 'Language server returned an invalid result') : failure(cause) });
const InitializeSchema = Schema.Struct({ capabilities: Schema.Record(Schema.String, Schema.Unknown), serverInfo: Schema.optional(Schema.Struct({ name: Schema.String, version: Schema.optional(Schema.String) })), offsetEncoding: Schema.optional(Schema.String) });
const supported = (value: unknown): boolean => value === true || Predicate.isObject(value);
function processFailure(result: OwnedProcessResult): ConcordError {
  if (!hasConfirmedOwnedGroupCleanup(result)) return new ConcordError('AnalysisCleanupUnknown', 'Language server process group cleanup could not be verified');
  if (result.cancelled) return new ConcordError('AnalysisCancelled', 'Language analysis was cancelled');
  if (result.timedOut || result.outputLimitExceeded) return new ConcordError('AnalysisBudgetExceeded', result.timedOut ? 'Language server exceeded totalMs' : 'Language server exceeded outputBytes');
  return new ConcordError('LanguageServerFailed', 'Language server exited before the protocol completed');
}

export const analyzeLanguageServer = (repo: Repository, server: LanguageServer, files: ReadonlyMap<string, string>, cases: readonly AnnotatedCase[], codes: readonly CodeDeclaration[], native?: { readonly scopes: ReadonlyMap<string, NativeAnalysisScope>; readonly gaps: ReadonlyMap<string, readonly string[]> }) => Effect.gen(function* () {
  const owned = yield* OwnedProcess;
  const budgets = analysisBudgets(server), rpc = new LspConnection(budgets);
  const env: NodeJS.ProcessEnv = {};
  for (const key of server.environment ?? []) if (process.env[key] !== undefined) env[key] = process.env[key];
  const matches = (path: string) => server.extensions.some(extension => path.endsWith(extension));
  const paths = [...files.keys()].filter(path => matches(path) && withinRoots(path, [...(repo.config.sourceRoots ?? []), ...repo.config.testRoots])).sort();
  if (paths.length > budgets.files) return yield* Effect.fail(new ConcordError('AnalysisBudgetExceeded', 'FileLimit'));
  const opened: string[] = [];
  let shutdown = false;
  let processResult: OwnedProcessResult | undefined;
  const fiber = yield* Effect.forkScoped(owned.run(server.argv, {
    cwd: server.cwd === '.' ? repo.root : repo.absolute(server.cwd), env,
    timeoutMs: budgets.totalMs, outputLimitBytes: budgets.outputBytes,
    stream: { ready: write => rpc.connect(write), stdout: chunk => rpc.receive(chunk) },
  }).pipe(Effect.tap(result => Effect.sync(() => { processResult = result; }))));
  yield* Effect.addFinalizer(() => Effect.gen(function* () {
    if (!shutdown && processResult === undefined) {
      yield* Effect.sync(() => {
        for (const uri of opened.splice(0)) try { rpc.notify('textDocument/didClose', { textDocument: { uri } }); } catch { /* The group remains scope-owned. */ }
      });
      yield* rpc.request('shutdown').pipe(Effect.timeoutOption(250), Effect.catch(() => Effect.void));
      yield* Effect.sync(() => { try { rpc.notify('exit'); } catch { /* Closed pipe. */ } });
    }
    yield* Effect.sync(() => rpc.cancel());
  }));
  const collect = Effect.gen(function* () {
    const initialized = yield* rpc.request('initialize', {
      processId: process.pid, rootUri: pathToFileURL(`${repo.root}/`).href,
      capabilities: { general: { positionEncodings: server.profile.positionEncodings }, textDocument: { synchronization: { didSave: false }, documentSymbol: { hierarchicalDocumentSymbolSupport: true }, callHierarchy: { dynamicRegistration: false } }, workspace: { applyEdit: false, workspaceEdit: { documentChanges: false }, configuration: false }, window: { workDoneProgress: true } },
      initializationOptions: server.initializationOptions,
      clientInfo: { name: 'concord', version: 'lsp-client/v1' },
    }).pipe(Effect.flatMap(value => sync(() => decode(InitializeSchema, value, 'initialize'))));
    if (initialized.serverInfo?.version !== server.profile.serverVersion) return yield* Effect.fail(new ConcordError('AnalysisInputUnverified', 'Language server did not confirm the pinned profile serverVersion'));
    const capabilities = initialized.capabilities;
    const encoding = yield* sync(() => decode(Schema.Literals(['utf-16', 'utf-8', 'utf-32']), capabilities.positionEncoding ?? 'utf-16', 'positionEncoding'));
    if (!server.profile.positionEncodings.includes(encoding)) return yield* Effect.fail(new ConcordError('LanguageServerFailed', 'Server selected an unoffered position encoding'));
    yield* sync(() => rpc.notify('initialized', {}));
    const synchronization = yield* sync(() => decode(Schema.Union([Schema.Int, Schema.Struct({ openClose: Schema.optional(Schema.Boolean), change: Schema.optional(Schema.Int), willSave: Schema.optional(Schema.Boolean), willSaveWaitUntil: Schema.optional(Schema.Boolean), save: Schema.optional(Schema.Union([Schema.Boolean, Schema.Struct({ includeText: Schema.optional(Schema.Boolean) })])) })]), capabilities.textDocumentSync ?? 0, 'textDocumentSync'));
    const canOpen = typeof synchronization === 'number' ? synchronization > 0 : synchronization.openClose === true;
    // LSP does not establish whether these execution boundaries are absent.
    const gaps = new Set<string>(['OpenWorldCalls', 'UnverifiedEnvironment', 'UnknownDynamicDispatch', 'UnknownSubprocessBoundary', 'UnknownProtocolBoundary']);
    const hierarchy = supported(capabilities.callHierarchyProvider);
    const symbolsSupported = supported(capabilities.documentSymbolProvider);
    if (!hierarchy || !symbolsSupported || !canOpen) gaps.add('CapabilityMissing');
    if (canOpen) for (const path of paths) yield* sync(() => {
      const uri = sourceUri(repo, path);
      rpc.notify('textDocument/didOpen', { textDocument: { uri, languageId: server.languageId, version: 1, text: files.get(path)! } }); opened.push(uri);
    });
    if (server.profile.readiness.kind === 'none') gaps.add('IndexReadinessUnknown');
    else {
      const token = server.profile.readiness.token;
      yield* Effect.whileLoop({ while: () => !rpc.endedProgress.has(token), body: () => Effect.sleep(10), step: () => {} }).pipe(Effect.timeoutOption(budgets.requestMs), Effect.tap(result => Effect.sync(() => { if (result._tag === 'None') gaps.add('IndexReadinessUnknown'); })));
    }
    const symbolsByPath = new Map<string, readonly DocumentSymbol[]>();
    const locators: { codeId: string; locator: SymbolLocator }[] = [];
    let symbolCount = 0;
    if (symbolsSupported && canOpen) for (const path of paths) {
      if (rpc.remainingRequests() <= 1) { gaps.add('RequestLimit'); break; }
      const value = yield* rpc.request('textDocument/documentSymbol', { textDocument: { uri: sourceUri(repo, path) } });
      const result = yield* sync(() => documentSymbols(value, files.get(path)!, encoding, budgets.symbols - symbolCount));
      symbolCount += flattenSymbols(result.symbols).length;
      symbolsByPath.set(path, result.symbols);
      for (const gap of result.gaps) gaps.add(gap);
      for (const code of codes.filter(code => code.file === path && code.scope === 'node')) {
        const locator = yield* sync(() => bindSymbol(code, files.get(path)!, result.symbols, server, encoding));
        if (locator === undefined) gaps.add('UnsupportedSymbolBinding');
        else locators.push({ codeId: code.id, locator });
      }
    }
    const dependencies: DependencyObservation[] = [];
    for (const test of cases.filter(item => matches(item.file))) {
      const scope = native?.scopes.get(test.id);
      const testGaps = new Set([...gaps, ...(scope?.gaps ?? ['FileScope', ...(native?.gaps.get(test.id) ?? [])])]);
      const declarations = new Set<string>(), edges: { from: string; to: string }[] = [];
      const queue: { item: CallItem; depth: number }[] = [];
      let requests = 0;
      const available = () => {
        // Reserve protocol shutdown. A non-fault truncation publishes its positive edges.
        if (++requests >= budgets.requests || rpc.remainingRequests() <= 1) { testGaps.add('RequestLimit'); return false; }
        return true;
      };
      const validate = (item: CallItem): string | undefined => {
        const path = uriPath(repo, item.uri, true);
        if (path === undefined) { testGaps.add('ExternalTarget'); return undefined; }
        const text = files.get(path);
        if (text === undefined || !matches(path)) { testGaps.add('ExternalTarget'); return undefined; }
        const range = validRange(text, item.range, encoding), selection = validRange(text, item.selectionRange, encoding);
        if (selection[0] < range[0] || selection[1] > range[1]) throw new ConcordError('LanguageServerFailed', 'Call selection range is outside declaration range');
        return path;
      };
      if (hierarchy && canOpen) for (const { symbol } of flattenSymbols(symbolsByPath.get(test.file) ?? [])) {
        // Methods and nested functions are roots too; classes alone are not callable.
        if (![6, 7, 9, 12, 13].includes(symbol.kind)) continue;
        if (scope !== undefined && !scope.ranges.some(range => symbol.range.start.line + 1 >= range.startLine && symbol.range.end.line + (symbol.range.end.character > 0 ? 1 : 0) <= range.endLine)) continue;
        if (!available()) break;
        const prepared = yield* rpc.request('textDocument/prepareCallHierarchy', { textDocument: { uri: sourceUri(repo, test.file) }, position: symbol.selectionRange.start }).pipe(Effect.flatMap(value => sync(() => decode(PrepareSchema, value, 'prepareCallHierarchy'))));
        if (prepared === null || prepared.length === 0) testGaps.add('UnknownTarget');
        for (const item of prepared ?? []) if (yield* sync(() => validate(item) !== undefined)) queue.push({ item, depth: 0 });
      }
      const visited = new Set<string>();
      while (queue.length > 0) {
        const current = queue.shift()!;
        const path = yield* sync(() => validate(current.item)); if (path === undefined) continue;
        const key = objectDigest({ path, range: current.item.range, kind: current.item.kind, name: current.item.name });
        if (visited.has(key)) continue;
        if (visited.size >= budgets.nodes) { testGaps.add('NodeLimit'); break; }
        visited.add(key);
        for (const code of codes.filter(code => code.file === path && withinRoots(path, repo.config.sourceRoots ?? []))) {
          const locator = locators.find(locator => locator.codeId === code.id)?.locator;
          const itemStart = current.item.selectionRange.start.line + 1;
          const bound = locator === undefined ? undefined : validRange(files.get(path)!, locator.range, encoding);
          const selected = validRange(files.get(path)!, current.item.selectionRange, encoding);
          if (code.scope === 'file' || code.scope === 'region' && code.line <= itemStart && itemStart <= code.endLine || bound !== undefined && bound[0] <= selected[0] && selected[1] <= bound[1]) declarations.add(code.id);
        }
        if (current.depth >= budgets.depth) { testGaps.add('DepthLimit'); continue; }
        if (!available()) break;
        const outgoing = yield* rpc.request('callHierarchy/outgoingCalls', { item: current.item }).pipe(Effect.flatMap(value => sync(() => decode(OutgoingSchema, value, 'outgoingCalls'))));
        if (outgoing === null) testGaps.add('UnknownTarget');
        for (const call of outgoing ?? []) {
          for (const range of call.fromRanges) yield* sync(() => {
            const source = validRange(files.get(path)!, current.item.range, encoding), callSite = validRange(files.get(path)!, range, encoding);
            if (callSite[0] < source[0] || callSite[1] > source[1]) throw new ConcordError('LanguageServerFailed', 'Call site lies outside its source declaration');
          });
          const target = yield* sync(() => validate(call.to)); if (target === undefined) continue;
          edges.push({ from: path, to: target });
          queue.push({ item: call.to, depth: current.depth + 1 });
        }
      }
      if (queue.length === 0 && visited.size === 0) testGaps.add('UnknownTarget');
      for (const gap of rpc.gaps) testGaps.add(gap);
      dependencies.push({ testId: test.id, scope: scope === undefined ? 'file' : 'native-case', file: test.file, declarations: [...declarations].sort(), edges, gaps: [...testGaps].sort(), ...(scope === undefined ? {} : { native: scope }) });
    }
    for (const uri of opened.splice(0)) yield* sync(() => rpc.notify('textDocument/didClose', { textDocument: { uri } }));
    yield* rpc.request('shutdown');
    yield* sync(() => { rpc.notify('exit'); shutdown = true; });
    return { analyzer: server.id, profile: server.profile.version, encoding: encoding as PositionEncoding, locators, dependencies, gaps: [...new Set([...gaps, ...dependencies.flatMap(item => item.gaps), ...rpc.gaps])].sort() } satisfies AnalysisValue;
  });
  const value = yield* Effect.raceFirst(collect, Fiber.join(fiber).pipe(Effect.flatMap(result => Effect.fail(processFailure(result)))));
  const result = yield* Fiber.join(fiber).pipe(Effect.timeoutOrElse({ duration: 1000, orElse: () => owned.stop('SIGTERM').pipe(Effect.andThen(Fiber.join(fiber))) }));
  if (!hasConfirmedOwnedGroupCleanup(result)) return yield* Effect.fail(processFailure(result));
  if (result.outputLimitExceeded || result.timedOut || result.error !== undefined || result.exitCode !== 0) return yield* Effect.fail(processFailure(result));
  if (result.groupCleanup.aliveAfterLeaderClose) return yield* Effect.fail(new ConcordError('LanguageServerFailed', 'Language server left running descendants after exit'));
  yield* sync(() => rpc.assertHealthy());
  return value;
}).pipe(Effect.scoped, Effect.mapError(failure), Effect.catchDefect(cause => Effect.fail(failure(cause))));
