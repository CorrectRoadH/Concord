// @concord-file
// @concord-implements docs/feature/herdr-panel/architecture.md#Herdr-插件
import { connect } from 'node:net';
import { isAbsolute } from 'node:path';
import { Effect, Schema } from 'effect';

export class PanelWorktreeUnknown extends Schema.TaggedError<PanelWorktreeUnknown>()('PanelWorktreeUnknown', { message: Schema.String }) {}
export class PanelHerdrUnavailable extends Schema.TaggedError<PanelHerdrUnavailable>()('PanelHerdrUnavailable', { message: Schema.String }) {}
const LaunchContext = Schema.Struct({ focused_pane_cwd: Schema.String.check(Schema.makeFilter(isAbsolute)), focused_pane_id: Schema.String.check(Schema.isMinLength(1)) });
export const panelWorktree = (context: unknown) => Schema.decodeUnknownEffect(LaunchContext, { onExcessProperty: 'ignore' })(context).pipe(
  Effect.map(value => ({ cwd: value.focused_pane_cwd, targetPaneId: value.focused_pane_id })),
  Effect.mapError(() => new PanelWorktreeUnknown({ message: 'PanelWorktreeUnknown：当前 pane 没有工作目录，无法打开 Spec 面板。' })),
);
export const panelOpenRequest = Effect.fn('panelOpenRequest')(function*(context: unknown) {
  const location = yield* panelWorktree(context);
  return { id: 'concord-panel', method: 'plugin.pane.open', params: {
    plugin_id: 'concord', entrypoint_id: 'spec', placement: 'split', direction: 'right',
    target_pane_id: location.targetPaneId, cwd: location.cwd, focus: true,
  } } as const;
});
const Reply = Schema.Union([
  Schema.Struct({ id: Schema.Literal('concord-panel'), result: Schema.Unknown }),
  Schema.Struct({ id: Schema.Literal('concord-panel'), error: Schema.Struct({ code: Schema.String, message: Schema.String }) }),
]);
/** Herdr's installed plugin examples use one newline-delimited request per socket. */
export const openHerdrPanel = Effect.fn('openHerdrPanel')(function*(context: unknown, socketPath: string) {
  const request = yield* panelOpenRequest(context);
  if (!socketPath) return yield* new PanelHerdrUnavailable({ message: 'Herdr did not provide HERDR_SOCKET_PATH.' });
  return yield* Effect.callback<unknown, PanelHerdrUnavailable>(resume => {
    const socket = connect(socketPath), chunks: Buffer[] = []; let bytes = 0;
    const failed = (message: string) => resume(Effect.fail(new PanelHerdrUnavailable({ message })));
    socket.once('connect', () => socket.write(JSON.stringify(request) + '\n'));
    socket.once('error', error => failed(error.message));
    socket.once('end', () => failed('Herdr closed the connection before its reply.'));
    socket.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 64 * 1024) { failed('Herdr reply exceeds 64 KiB.'); socket.destroy(); return; }
      chunks.push(chunk);
      const text = Buffer.concat(chunks).toString('utf8'), end = text.indexOf('\n');
      if (end < 0) return;
      const decoded = Schema.decodeUnknownEffect(Schema.fromJsonString(Reply), { onExcessProperty: 'error' })(text.slice(0, end)).pipe(
        Effect.mapError(error => new PanelHerdrUnavailable({ message: String(error) })),
        Effect.flatMap(reply => 'error' in reply ? Effect.fail(new PanelHerdrUnavailable({ message: `${reply.error.code}: ${reply.error.message}` })) : Effect.succeed(reply.result)),
      );
      resume(decoded);
    });
    return Effect.sync(() => socket.destroy());
  }).pipe(Effect.timeout('3 seconds'), Effect.mapError(error => error instanceof PanelHerdrUnavailable ? error : new PanelHerdrUnavailable({ message: 'Herdr pane request timed out.' })));
});

/** Kept in the Concord installation; the installed plugin contains only a manifest. */
export function bindHerdrManifest(template: string, entry: string, node: string, action: string): string {
  if (![entry, node, action].every(isAbsolute)) throw new Error('Herdr commands must use absolute installation paths.');
  let section = '';
  return template.split('\n').map(line => {
    if (/^\[\[\w+\]\]$/u.test(line)) section = line;
    if (/^command\s*=/u.test(line) && section === '[[panes]]') return `command = ${JSON.stringify([entry, 'panel'])}`;
    if (/^command\s*=/u.test(line) && section === '[[actions]]') return `command = ${JSON.stringify([node, action])}`;
    return line;
  }).join('\n');
}
