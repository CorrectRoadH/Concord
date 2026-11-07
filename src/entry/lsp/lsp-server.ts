// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/use-editor-service.md
import { applicationRuntime, type ApplicationRuntime } from '../../app/index.ts';
import { createReadRepository } from "../../app/index.ts";
import { lstatSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { type Cause, Effect, Fiber, Queue, Schema, Stdio, Stream } from "effect";
import { discoverRoot, readRepositoryFileSync } from "../../app/index.ts";
import { uriPath } from "../../app/index.ts";
import { randomUUID } from "node:crypto";
import { ConcordError, decode, digest, failure } from "../../model/index.ts";
import * as P from '../../model/editor/index.ts';
import { runEditorJob } from "../../app/index.ts";
import { makeOwnedProcessService } from "../../app/index.ts";

interface Task {
  readonly id?: P.RpcId;
  readonly session: string;
  readonly controller: AbortController;
  promise: Promise<void>;
}

/** Final verification deliberately opens a fresh config authorization context. */
async function verify(root: string, result: P.Computed, runtime: ApplicationRuntime): Promise<void> {
  const repo = await createReadRepository(root, { access: 'read', optimistic: true, persistentCache: 'off', runtime });
  try {
    repo.snapshot(() => {
      if (repo.configSnapshot.digest !== result.config) throw new ConcordError('ContentModified', 'Configuration changed');
      for (const [path, before, identity] of result.reads) {
        const current = repo.read(path);
        if ((current === undefined ? null : digest(current)) !== before) throw new ConcordError('ContentModified', `${path} changed`);
        const stat = current === undefined ? undefined : lstatSync(repo.absolute(path), { bigint: true });
        if ((stat === undefined ? null : `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`) !== identity) throw new ConcordError('ContentModified', `${path} disk identity changed`);
      }
      for (const list of result.listings) if (JSON.stringify(repo.files(list.prefix, list.source ? 'source' : undefined)) !== JSON.stringify(list.paths)) throw new ConcordError('ContentModified', `${list.prefix} membership changed`);
    });
  } finally { repo.close(); }
}

export const serveEditor = Effect.fn('editor.serve')(function*(rootInput?: string, createProcessService = makeOwnedProcessService) {
  return yield* Effect.scoped(Effect.gen(function*() {
  const runtime = yield* applicationRuntime;
  const stdio = yield* Stdio.Stdio;
  const context = yield* Effect.context<Effect.Services<typeof applicationRuntime>>();
  const stdout = yield* Queue.unbounded<Uint8Array, Cause.Done>();
  const stderr = yield* Queue.unbounded<Uint8Array, Cause.Done>();
  let bufferedBytes = 0, exitCode = 0;
  let outputFailure: unknown;
  let transportFailed: (cause: unknown) => void = () => {};
  const output = yield* Effect.forkScoped(Stream.runForEach(Stream.fromQueue(stdout), bytes => Stream.run(Stream.succeed(bytes), stdio.stdout({ endOnDone: false })).pipe(Effect.tap(() => Effect.sync(() => { bufferedBytes -= bytes.byteLength; })))).pipe(Effect.catch(cause => Effect.sync(() => { outputFailure ??= cause; transportFailed(cause); }))));
  const errors = yield* Effect.forkScoped(Stream.run(Stream.fromQueue(stderr), stdio.stderr({ endOnDone: false })).pipe(Effect.catch(cause => Effect.sync(() => { outputFailure ??= cause; transportFailed(cause); }))));
  yield* Effect.addFinalizer(() => Queue.end(stdout).pipe(Effect.andThen(Queue.end(stderr)), Effect.andThen(Fiber.join(output)), Effect.andThen(Fiber.join(errors)), Effect.andThen(Effect.suspend(() => outputFailure === undefined ? Effect.void : Effect.die(failure(outputFailure))))));
  const root = yield* Effect.try({ try: () => discoverRoot(rootInput, false, runtime), catch: failure });
  // Validate the initial project without retaining a repository handle while waiting for stdin.
  yield* Effect.tryPromise({ try: async () => { const repo = await createReadRepository(root, { access: 'read', persistentCache: 'off', runtime }); repo.close(); }, catch: failure }).pipe(Effect.uninterruptible);
  yield* Effect.callback<void, ConcordError>(resume => {
    let inputFiber: Fiber.Fiber<void> | undefined;
    const frames = new P.EditorFrames();
    const overlays = new Map<string, P.Overlay>();
    const tasks = new Set<Task>();
    const running = new Set<Task>();
    let session = randomUUID();
    let state: 'new' | 'initializing' | 'ready' | 'shutdown' = 'new';
    let ended = false;
    let cleanupFailure: ConcordError | undefined;
    const recordCleanupFailure = (error: ConcordError) => {
      cleanupFailure ??= error;
      if (timer !== undefined) clearTimeout(timer);
    };
    let cleanupPromise: Promise<void> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: ConcordError) => {
      if (ended) return;
      ended = true;
      if (timer !== undefined) clearTimeout(timer);
      for (const task of tasks) task.controller.abort();
      void cleanup().then(() => resume(error === undefined ? Effect.void : Effect.fail(error)), cause => resume(Effect.fail(failure(cause))));
    };
    const send = (message: unknown) => {
      if (ended) return;
      const text = JSON.stringify(message), bytes = Buffer.byteLength(text);
      if (bytes > P.editorLimits.message || bufferedBytes + bytes > P.editorLimits.output) { finish(new ConcordError('EditorBudgetExceeded', 'Output buffer limit')); return; }
      const frame = Buffer.from(`Content-Length: ${bytes}\r\n\r\n${text}`);
      bufferedBytes += frame.byteLength;
      Queue.offerUnsafe(stdout, frame);
    };
    const respond = (id: P.RpcId, result: unknown) => send({ jsonrpc: '2.0', id, result });
    const reject = (id: P.RpcId, code: number, name: string, message = name) => send({ jsonrpc: '2.0', id, error: { code, message, data: { name } } });
    const rejectCleanupFailure = (id: P.RpcId | undefined): boolean => {
      if (cleanupFailure === undefined) return false;
      if (id !== undefined) reject(id, -32603, cleanupFailure.code, cleanupFailure.message);
      return true;
    };
    const log = (cause: unknown) => { const error = failure(cause); Queue.offerUnsafe(stderr, Buffer.from(`${error.code}: ${error.message.slice(0, 2000)}\n`)); };
    const clear = (document: P.Overlay) => send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: document.uri, version: document.version, diagnostics: [] } });
    const resolveUri = async (uri: string) => {
      const repo = await createReadRepository(root, { access: 'read', persistentCache: 'off', runtime });
      try {
        const path = uriPath(repo, uri);
        if (path.split('/').some(part => part === '.git' || part === 'node_modules')) throw new ConcordError('UnsafeEditorUri', 'Private and dependency paths are excluded');
        return { path, uri: pathToFileURL(repo.absolute(path)).href, existed: repo.read(path) !== undefined };
      } catch (cause) { throw new ConcordError('UnsafeEditorUri', failure(cause).message); }
      finally { repo.close(); }
    };
    const stopTask = (task: Task, name: 'RequestCancelled' | 'ContentModified') => {
      if (!tasks.delete(task)) return;
      if (task.id !== undefined) reject(task.id, name === 'RequestCancelled' ? -32800 : -32801, name);
      task.controller.abort();
    };
    const schedule = () => {
      if (timer !== undefined) clearTimeout(timer);
      if (ended || cleanupFailure !== undefined || state !== 'ready' || overlays.size === 0) return;
      timer = setTimeout(() => { timer = undefined; start('diagnostics'); }, 25);
    };
    const invalidate = () => {
      session = randomUUID();
      for (const task of [...tasks]) stopTask(task, 'ContentModified');
      schedule();
    };
    const start = (method: string, id?: P.RpcId, params?: P.Job['params']) => {
      if (cleanupFailure !== undefined) { if (id !== undefined) reject(id, -32603, cleanupFailure.code, cleanupFailure.message); return; }
      if (running.size >= P.editorLimits.tasks) { if (id !== undefined) reject(id, -32000, 'EditorBudgetExceeded', 'Concurrent task limit'); else schedule(); return; }
      const duplicate = id === undefined ? undefined : [...tasks].find(task => task.id === id);
      if (duplicate !== undefined && id !== undefined) { tasks.delete(duplicate); duplicate.controller.abort(); reject(id, -32600, 'DuplicateRequest'); return; }
      const task: Task = { id, session, controller: new AbortController(), promise: Promise.resolve() };
      tasks.add(task);
      running.add(task);
      const work = Effect.try({ try: (): P.Job => {
        const config = readRepositoryFileSync(root, 'concord.config.ts');
        if (config === undefined) throw new ConcordError('ProjectNotFound', 'Project configuration is missing');
        return { root, session, config: digest(config), overlays: [...overlays.values()], method, ...(params === undefined ? {} : { params }) };
      }, catch: failure }).pipe(Effect.flatMap(job => runEditorJob(job, recordCleanupFailure, createProcessService({ environment: runtime }))));
      task.promise = Effect.runPromise(work.pipe(Effect.provideContext(context)), { signal: task.controller.signal }).then(async result => {
        if (!tasks.has(task) || ended) return;
        if (rejectCleanupFailure(id)) return;
        if (result.session !== session || task.session !== session) { stopTask(task, 'ContentModified'); return; }
        try { await verify(root, result, runtime); }
        catch { stopTask(task, 'ContentModified'); schedule(); return; }
        if (!tasks.has(task) || ended || result.session !== session || task.session !== session) return;
        if (rejectCleanupFailure(id)) return;
        if (id !== undefined) respond(id, result.value);
        // Query results never publish diagnostics: a diagnostics job owns that stream.
        else for (const item of result.diagnostics) {
          const document = overlays.get(item.uri);
          if (document?.valid && document.version === item.version) send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: item });
        }
      }, cause => {
        if (!tasks.has(task) || ended) return;
        const error = failure(cause); log(error);
        if (id !== undefined) reject(id, ['SourceChanged', 'FileChangedSinceRead', 'ContentModified'].includes(error.code) ? -32801 : -32603, error.code, error.message);
        else for (const document of overlays.values()) if (document.valid) send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: document.uri, version: document.version, diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, severity: 2, source: 'concord', code: 'EditorInputsIncomplete', message: `${error.code}: ${error.message}. No complete-project conclusion is available.` }] } });
      }).finally(() => { tasks.delete(task); running.delete(task); });
    };
    const existing = async (uri: string) => {
      const safe = await resolveUri(uri), document = overlays.get(safe.uri);
      if (document === undefined) throw new ConcordError('DocumentNotOpen', safe.path);
      return document;
    };
    const capacity = (text: string, replacing?: P.Overlay) => {
      const bytes = Buffer.byteLength(text);
      if (bytes > P.editorLimits.document || bytes + [...overlays.values()].reduce((sum, doc) => sum + (doc === replacing ? 0 : Buffer.byteLength(doc.text)), 0) > P.editorLimits.overlay) throw new ConcordError('EditorBudgetExceeded', 'Overlay text limit');
    };
    const dispatch = async (input: unknown): Promise<void> => {
      let message: typeof P.Envelope.Type;
      try { message = decode(P.Envelope, input, 'editor JSON-RPC'); }
      catch (cause) { log(cause); send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'InvalidEditorMessage' } }); return; }
      const { method, id, params } = message;
      try {
        if (method === 'exit') {
          if (id !== undefined) throw new ConcordError('InvalidEditorMessage', 'exit is a notification');
          if (params !== undefined && params !== null) decode(P.Empty, params, method);
          if (state !== 'shutdown') exitCode = 1;
          finish(); return;
        }
        if (method === 'initialize') {
          if (id === undefined || state !== 'new') throw new ConcordError('InvalidEditorState', 'initialize must be the first request');
          const init = decode(P.Initialize, params, method);
          if (init.rootUri !== null) {
            const url = new URL(init.rootUri);
            if (url.href !== pathToFileURL(root).href && url.href !== `${pathToFileURL(root).href}/`) throw new ConcordError('UnsafeEditorUri', 'initialize root differs from the selected worktree');
          }
          if (init.workspaceFolders?.some(folder => folder.uri.replace(/\/$/u, '') !== pathToFileURL(root).href)) throw new ConcordError('UnsafeEditorUri', 'Only the selected worktree is supported');
          state = 'initializing';
          respond(id, { capabilities: { positionEncoding: 'utf-16', textDocumentSync: { openClose: true, change: 2, save: { includeText: true } }, definitionProvider: true, referencesProvider: true, completionProvider: { triggerCharacters: ['/', '#'] }, hoverProvider: true }, serverInfo: { name: 'Concord editor' } }); return;
        }
        if (method === 'initialized') {
          if (id !== undefined || state !== 'initializing') throw new ConcordError('InvalidEditorState', 'Unexpected initialized');
          decode(P.Empty, params ?? {}, method); state = 'ready'; return;
        }
        if (method === '$/cancelRequest') {
          if (id !== undefined) throw new ConcordError('InvalidEditorMessage', 'cancelRequest is a notification');
          const cancel = decode(P.Cancel, params, method);
          for (const task of [...tasks]) if (task.id === cancel.id) stopTask(task, 'RequestCancelled');
          return;
        }
        if (method === 'shutdown') {
          if (id === undefined || state === 'new' || state === 'shutdown') throw new ConcordError('InvalidEditorState', 'Unexpected shutdown');
          if (params !== undefined && params !== null) decode(P.Empty, params, method);
          state = 'shutdown'; if (timer !== undefined) clearTimeout(timer);
          for (const task of [...tasks]) stopTask(task, 'RequestCancelled');
          for (const document of overlays.values()) clear(document);
          overlays.clear();
          // A completed shutdown acknowledges that computation resources have
          // ended; the transport alone remains available for the exit message.
          void Promise.allSettled([...running].map(task => task.promise)).then(() => {
            if (cleanupFailure !== undefined) reject(id, -32603, cleanupFailure.code, cleanupFailure.message);
            else respond(id, null);
          });
          return;
        }
        if (state !== 'ready') { if (id !== undefined) reject(id, -32002, 'ServerNotInitialized'); return; }
        if (['textDocument/definition', 'textDocument/references', 'textDocument/completion', 'textDocument/hover'].includes(method)) {
          if (id === undefined) throw new ConcordError('InvalidEditorMessage', 'Navigation requires a request ID');
          const query = decode(method === 'textDocument/references' ? P.References : method === 'textDocument/completion' ? P.Completion : P.Query, params, method);
          const document = await existing(query.textDocument.uri);
          if (!document.valid) { reject(id, -32801, 'ContentModified', 'Close and reopen the invalid document'); return; }
          start(method, id, { ...query, textDocument: { uri: document.uri } }); return;
        }
        const lifecycle = ['textDocument/didOpen', 'textDocument/didChange', 'textDocument/didSave', 'textDocument/didClose', 'workspace/didChangeWatchedFiles', 'workspace/didDeleteFiles', 'workspace/didRenameFiles'];
        if (!lifecycle.includes(method)) { if (id !== undefined) reject(id, -32601, 'EditorMethodNotSupported', `Read-only editor does not support ${method}`); return; }
        if (id !== undefined) throw new ConcordError('InvalidEditorMessage', 'Document lifecycle methods are notifications');
        if (method === 'textDocument/didOpen') {
          const { textDocument: document } = decode(P.Open, params, method), safe = await resolveUri(document.uri);
          if (overlays.has(safe.uri)) throw new ConcordError('DocumentAlreadyOpen', safe.path);
          if (overlays.size >= P.editorLimits.documents) throw new ConcordError('EditorBudgetExceeded', 'Open document limit');
          capacity(document.text);
          overlays.set(safe.uri, { ...document, ...safe, opened: randomUUID(), valid: true }); invalidate();
        } else if (method === 'textDocument/didChange') {
          const change = decode(P.Change, params, method), document = await existing(change.textDocument.uri);
          if (!document.valid || change.textDocument.version <= document.version) throw new ConcordError('InvalidDocumentVersion', 'Versions must increase; close and reopen');
          const text = P.changedText(document.text, change.contentChanges); capacity(text, document);
          overlays.set(document.uri, { ...document, text, version: change.textDocument.version }); invalidate();
        } else if (method === 'textDocument/didSave') {
          const save = decode(P.Save, params, method), document = await existing(save.textDocument.uri);
          if (!document.valid || save.text !== undefined && save.text !== document.text) throw new ConcordError('SaveTextConflict', 'Saved text differs from the client overlay; close and reopen');
          overlays.set(document.uri, { ...document, existed: document.existed || (await resolveUri(document.uri)).existed });
          invalidate();
        } else if (method === 'textDocument/didClose') {
          const close = decode(P.Close, params, method), document = overlays.get(close.textDocument.uri) ?? await existing(close.textDocument.uri);
          clear(document); overlays.delete(document.uri); invalidate();
        } else {
          const observe = async (uri: string, deleted: boolean) => {
            const safe = await resolveUri(uri), document = overlays.get(safe.uri);
            if (document !== undefined && (safe.existed || deleted)) overlays.set(document.uri, { ...document, existed: true });
          };
          if (method === 'workspace/didChangeWatchedFiles') for (const change of decode(P.Watched, params, method).changes) await observe(change.uri, change.type === 3);
          else if (method === 'workspace/didDeleteFiles') for (const file of decode(P.Deleted, params, method).files) await observe(file.uri, true);
          else for (const file of decode(P.Renamed, params, method).files) {
            const old = await resolveUri(file.oldUri); await resolveUri(file.newUri);
            const document = overlays.get(old.uri);
            if (document !== undefined) { clear(document); overlays.set(document.uri, { ...document, valid: false }); }
          }
          invalidate();
        }
      } catch (cause) {
        log(cause);
        if (id !== undefined) reject(id, -32602, failure(cause).code, failure(cause).message);
        else if (method.startsWith('textDocument/did')) {
          try {
            const probe = Schema.decodeUnknownSync(Schema.Struct({ textDocument: Schema.Struct({ uri: Schema.String }) }), { onExcessProperty: 'ignore' })(params);
            const document = overlays.get(probe.textDocument.uri) ?? overlays.get((await resolveUri(probe.textDocument.uri)).uri);
            if (document !== undefined) { overlays.set(document.uri, { ...document, valid: false }); clear(document); invalidate(); }
          } catch { /* Unsafe URIs never enter the overlay. */ }
        }
      }
    };
    const data = async (chunk: Buffer) => {
      try {
        const messages: unknown[] = [];
        frames.receive(chunk, message => { messages.push(message); });
        for (const message of messages) { if (ended) break; await dispatch(message); }
      } catch (cause) { finish(failure(cause)); }
    };
    const eof = () => { try { frames.end(); finish(); } catch (cause) { finish(failure(cause)); } };
    const ioError = (cause: unknown) => finish(new ConcordError('EditorTransportFailed', failure(cause).message));
    transportFailed = ioError;
    inputFiber = Effect.runFork(Stream.runForEach(stdio.stdin, chunk => Effect.promise(() => data(Buffer.from(chunk))).pipe(Effect.uninterruptible)).pipe(Effect.match({ onFailure: ioError, onSuccess: eof })));
    function cleanup(): Promise<void> { return cleanupPromise ??= (async () => {
      ended = true; if (timer !== undefined) clearTimeout(timer);
      if (inputFiber !== undefined) await Effect.runPromise(Fiber.interrupt(inputFiber));
      for (const task of running) task.controller.abort();
      await Promise.allSettled([...running].map(task => task.promise));
      tasks.clear(); running.clear(); overlays.clear(); frames.clear();
      if (cleanupFailure !== undefined) throw cleanupFailure;
    })(); }
    return Effect.promise(cleanup);
  });
  return exitCode;
  }));
});
