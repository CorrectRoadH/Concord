import { chmodSync, cpSync, existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect } from 'effect';

export const sourceRoot = fileURLToPath(new URL('../..', import.meta.url));
export const sourceCli = (owner = sourceRoot): string => join(owner, 'src/entry/cli/entry.ts');
export const sourceCliCommand = (entry = sourceCli(), runtime: readonly string[] = []): [string, ...string[]] => [
  'bun', '--no-env-file', '--config=/dev/null', '--conditions=concord-source',
  '--preload', fileURLToPath(new URL('./source-runtime.ts', import.meta.url)), ...runtime, entry,
];

// Directly selected tests and their product children resolve the public source exports too.
Effect.runSync(Effect.sync(() => {
  const options = process.env.NODE_OPTIONS ?? '';
  if (!options.split(/\s+/u).includes('--conditions=concord-source')) process.env.NODE_OPTIONS = `${options} --conditions=concord-source`.trim();
}));

/** Link public source exports and external fixture dependencies without installing Concord. */
export function prepareSourceConsumer(directory: string, dependencies: readonly string[] = []): void {
  Effect.runSync(Effect.sync(() => {
    const modules = join(directory, 'node_modules');
    mkdirSync(modules, { recursive: true });
    const product = join(modules, 'concord-sdlc');
    if (!existsSync(product)) symlinkSync(sourceRoot, product, 'junction');
    for (const dependency of dependencies) {
      const name = dependency.slice(0, dependency.lastIndexOf('@'));
      const path = join(modules, name);
      mkdirSync(dirname(path), { recursive: true });
      if (!existsSync(path)) symlinkSync(join(sourceRoot, 'node_modules', name), path, 'junction');
    }
    if (dependencies.length) cpSync(join(sourceRoot, 'node_modules/.bin'), join(modules, '.bin'), { recursive: true });
    mkdirSync(join(modules, '.bin'), { recursive: true });
    const command = sourceCliCommand();
    if (process.platform === 'win32') writeFileSync(join(modules, '.bin/concord.cmd'), `@${command.map(value => `"${value}"`).join(' ')} %*\r\n`);
    else {
      const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
      writeFileSync(join(modules, '.bin/concord'), `#!/bin/sh\nexec ${command.map(quote).join(' ')} "$@"\n`);
      chmodSync(join(modules, '.bin/concord'), 0o755);
    }
  }));
}
