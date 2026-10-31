import type { RenderOptions } from 'ink';
import { Effect, Fiber, Schema, Stream, type Scope } from 'effect';
import { workspaceDisplay, workspacePathHref } from '../../model/workspace-display/index.js';
import { WorkspaceServerEvent, type WorkspaceProjectionSnapshot } from '../../model/index.js';
import { requestWorkspace, subscribeWorkspace, type WorkspaceConnection } from '../server/index.js';
import { OwnedProcess } from '../../base/process/index.js';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { plainPanelFrame, type BoundPanelBody } from './layout.js';
import { initialPanelState, reconcilePanelState, panelItems } from './state.js';
import type { PanelGeneration, PanelPorts, PanelFirstFrame } from './ports.js';
const BodyRead = Schema.Struct({ path: Schema.String, digest: Schema.String, body: Schema.String });
export const renderPanel = (ports: PanelPorts, initial?: PanelGeneration, options?: RenderOptions, frame?: PanelFirstFrame) => Effect.tryPromise(() => import('./renderer.js')).pipe(Effect.flatMap(renderer => renderer.renderPanel(ports, initial, options, frame, Object.hasOwn(process.env, 'NO_COLOR'))));

const Lease = Schema.Struct({ address: Schema.String, host: Schema.String, port: Schema.Int, lease: Schema.String, token: Schema.String });
export const serveWorkspacePanel = Effect.fn('serveWorkspacePanel')(function*(root: string, connect: (root: string) => Effect.Effect<WorkspaceConnection, unknown, Scope.Scope>, initial?: WorkspaceConnection) {
  return yield* Effect.scoped(Effect.gen(function*() {
    const owner = yield* OwnedProcess;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const input = yield* Effect.acquireRelease(Effect.sync(() => {
      const chunks: Buffer[] = []; let bytes = 0;
      const wasRaw = process.stdin.isRaw, wasPaused = process.stdin.isPaused();
      const capture = (chunk: Buffer | string) => {
        const next = Buffer.from(chunk).subarray(0, Math.max(0, 65536 - bytes));
        if (next.byteLength) { chunks.push(next); bytes += next.byteLength; }
      };
      if (process.stdin.isTTY) { process.stdin.setRawMode(true); process.stdin.on('data', capture); }
      const drain = () => {
        process.stdin.off('data', capture); process.stdin.pause();
        if (chunks.length) process.stdin.unshift(Buffer.concat(chunks));
      };
      return { drain, close: () => { process.stdin.off('data', capture); if (process.stdin.isTTY) process.stdin.setRawMode(wasRaw ?? false); if (wasPaused) process.stdin.pause(); } };
    }), input => Effect.sync(input.close));
    let connection: WorkspaceConnection | undefined = initial ?? (yield* connect(root));
    let initialConnection: WorkspaceConnection | undefined = connection;
    let snapshot: WorkspaceProjectionSnapshot | undefined;
    const connected = () => {
      if (!connection) throw new Error('工作区服务正在重连');
      return connection;
    };
    const ports: PanelPorts = {
      read: request => requestWorkspace(connected(), 'read', request).pipe(Effect.flatMap(value => Schema.decodeUnknownEffect(BodyRead, { onExcessProperty: 'ignore' })(value)), Effect.mapError(cause => cause instanceof Error ? cause : new Error(String(cause)))),
      openInWeb: path => Effect.gen(function*() {
        const current = connected();
        const value = yield* requestWorkspace(current, 'http', { action: 'open', host: '127.0.0.1', port: 4317 });
        const lease = yield* Schema.decodeUnknownEffect(Lease, { onExcessProperty: 'error' })(value);
        const address = new URL(snapshot ? workspacePathHref(snapshot, path) : `/docs?file=${encodeURIComponent(path)}`, lease.address).href;
        const browser = yield* owner.resolveExecutable(root, process.platform === 'darwin' ? 'open' : 'xdg-open', owner.environment.env.PATH ?? '').pipe(Effect.catch(() => Effect.succeed(undefined)));
        if (browser) yield* Effect.scoped(spawner.spawn(ChildProcess.make(browser.executable, [address], { cwd: owner.environment.cwd, detached: true, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' })).pipe(Effect.flatMap(child => child.unref), Effect.ignore));
        return address;
      }).pipe(Effect.mapError(cause => cause instanceof Error ? cause : new Error(String(cause)))),
    };
    const first = yield* Stream.runHead(subscribeWorkspace(connected()));
    const event = first._tag === 'Some' ? yield* Schema.decodeUnknownEffect(WorkspaceServerEvent, { onExcessProperty: 'error' })(first.value) : undefined;
    snapshot = event?.workspace?.snapshot;
    const generation = snapshot ? { model: workspaceDisplay(snapshot) } : undefined;
    const state = generation ? reconcilePanelState(initialPanelState, undefined, generation.model) : initialPanelState;
    const bodies = new Map<string, BoundPanelBody>();
    const selected = generation && panelItems(generation.model).find(item => item.path === state.selected);
    if (selected?.digest && generation) {
      const body = yield* ports.read({ path: selected.sourcePath ?? selected.path, expectedDigest: selected.digest }).pipe(Effect.catch(() => Effect.succeed(undefined)));
      if (body?.digest === selected.digest) bodies.set(selected.path, { ...body, path: selected.path, model: generation.model });
    }
    const text = plainPanelFrame({ model: generation?.model, state, bodies, columns: process.stdout.columns || 80, rows: process.stdout.rows || 24, noColor: Object.hasOwn(process.env, 'NO_COLOR') });
    yield* Effect.sync(() => process.stdout.write(text));
    // Importing Ink is intentionally after the first readable frame.
    const renderer = yield* Effect.tryPromise(() => import('./renderer.js'));
    yield* Effect.sync(() => process.stdout.write(`\r\x1b[${text.split('\n').length - 1}A\x1b[0J`));
    const session = yield* renderer.renderPanel(ports, generation, {}, { state, bodies }, Object.hasOwn(process.env, 'NO_COLOR'));
    yield* Effect.sync(input.drain);
    const watch = Effect.forever(Effect.scoped(Effect.gen(function*() {
      connection = initialConnection ?? (yield* connect(root));
      initialConnection = undefined;
      yield* Stream.runForEach(subscribeWorkspace(connection), input => Effect.gen(function*() {
        const event = yield* Schema.decodeUnknownEffect(WorkspaceServerEvent, { onExcessProperty: 'error' })(input);
        if (event.workspace) { snapshot = event.workspace.snapshot; yield* session.update({ model: workspaceDisplay(snapshot) }); }
        else yield* session.update(undefined);
      }));
    })).pipe(Effect.catch(() => Effect.void), Effect.andThen(Effect.sync(() => { connection = undefined; })), Effect.andThen(session.update(undefined, true)), Effect.andThen(Effect.sleep('250 millis'))));
    yield* Effect.raceFirst(session.closed, watch);
  }));
});
