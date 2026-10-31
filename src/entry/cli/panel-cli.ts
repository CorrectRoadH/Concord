// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#入口与命令加载
import { Command } from 'effect/unstable/cli';
import { root } from './cli-base.js';
import { panel } from './cli-command-panel.js';
import { runPanelCli } from './main.js';
import type { StartupData } from '../../model/index.js';

export function loadPanel(data: StartupData): () => void {
  const commands = data.groups.map(item => item.name === 'panel' ? panel : Command.make(item.name).pipe(Command.withDescription(item.description ?? '')));
  const command = root.pipe(Command.withSubcommands(commands));
  return () => runPanelCli(command);
}
