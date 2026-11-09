import assert from 'node:assert/strict';
import test from 'node:test';
import { fullCommand } from '../../src/entry/cli/cli-full.ts';
import { runCli } from '../support/cli.ts';

// @feature docs/feature/local-sdlc/README.md
test('real CLI help renders every top-level command definition', async () => {
  const help = await runCli({ argv: ['--help'], cwd: process.cwd(), env: { ...process.env, NO_COLOR: '1' } });
  assert.equal(help.exitCode, 0, help.stderr);
  const section = help.stdout.split(/SUBCOMMANDS\s*\n/u)[1]?.split(/\n[A-Z][A-Z ]+:?\n/u)[0] ?? '';
  const names = [...new Set([...section.matchAll(/^ {2}([a-z][a-z0-9-]*)(?: {2,}|$)/gmu)].map(match => match[1]!))];
  assert.deepEqual(names.sort(), fullCommand.subcommands.flatMap(group => group.commands.map(command => command.name)).sort());
});
