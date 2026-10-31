// @concord-file
// @concord-implements docs/feature/herdr-panel/architecture.md#herdr-插件
import { isAbsolute, relative, sep } from 'node:path';
import { Effect, Schema } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';

export class PanelWorktreeUnknown extends Schema.TaggedError<PanelWorktreeUnknown>()('PanelWorktreeUnknown', { message: Schema.String }) {}
export class PanelHerdrUnavailable extends Schema.TaggedError<PanelHerdrUnavailable>()('PanelHerdrUnavailable', { message: Schema.String }) {}
const LaunchContext = Schema.Struct({ focused_pane_cwd: Schema.String.check(Schema.makeFilter(isAbsolute)), focused_pane_id: Schema.String.check(Schema.isMinLength(1)) });
export const panelWorktree = (context: unknown) => Schema.decodeUnknownEffect(LaunchContext, { onExcessProperty: 'ignore' })(context).pipe(
  Effect.map(value => ({ cwd: value.focused_pane_cwd, targetPaneId: value.focused_pane_id })),
  Effect.mapError(() => new PanelWorktreeUnknown({ message: 'PanelWorktreeUnknown：当前 pane 没有工作目录，无法打开 Spec 面板。' })),
);
/** CLI spelling of --cwd / --target-pane-id still needs verification on a real host. */
export const panelOpenCommand = Effect.fn('panelOpenCommand')(function*(context: unknown, binary = 'herdr') {
  const location = yield* panelWorktree(context);
  return { binary, cwd: location.cwd, args: [
    'plugin', 'pane', 'open', '--plugin', 'concord', '--entrypoint', 'spec',
    '--placement', 'split', '--direction', 'right', '--focus',
    '--cwd', location.cwd, '--target-pane-id', location.targetPaneId,
  ] };
});
/** Use the host's injected CLI just like its installed file-viewer plugin. */
export const openHerdrPanel = Effect.fn('openHerdrPanel')(function*(context: unknown, binary = 'herdr') {
  const command = yield* panelOpenCommand(context, binary);
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const code = yield* spawner.exitCode(ChildProcess.make(command.binary, command.args, { cwd: command.cwd, stdout: 'inherit', stderr: 'inherit' })).pipe(
    Effect.mapError(error => new PanelHerdrUnavailable({ message: String(error) })),
  );
  if (code !== 0) return yield* new PanelHerdrUnavailable({ message: `Herdr pane command exited with status ${code}.` });
});

/** Bound commands execute Node and this installation directly, without PATH lookup. */
export function bindHerdrManifest(template: string, entry: string, node: string, action: string): string {
  if (![entry, node, action].every(isAbsolute)) throw new Error('Herdr commands must use absolute installation paths.');
  let section = '';
  return template.split('\n').map(line => {
    if (/^\[\[\w+\]\]$/u.test(line)) section = line;
    if (/^command\s*=/u.test(line) && section === '[[panes]]') return `command = ${JSON.stringify([node, entry, 'panel'])}`;
    if (/^command\s*=/u.test(line) && section === '[[actions]]') return `command = ${JSON.stringify([node, action])}`;
    return line;
  }).join('\n');
}

export function pluginDestinationAllowed(installationRoot: string, destination: string): boolean {
  const path = relative(installationRoot, destination);
  return path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path);
}
