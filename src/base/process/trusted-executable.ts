import { accessSync, constants, realpathSync } from 'node:fs';
import { delimiter, isAbsolute, join, relative, sep } from 'node:path';
import { Effect } from 'effect';
import { OwnedProcessError } from './owned-process-error.ts';

const within = (path: string, root: string): boolean => path === root || (!relative(root, path).startsWith(`..${sep}`) && relative(root, path) !== '..' && !isAbsolute(relative(root, path)));
const packagePath = (path: string): boolean => path.split(sep).includes('node_modules');

/** Never resolve repository commands or package-manager shims as a trusted tool. */
export const resolveTrustedExecutable = Effect.fn('OwnedProcess.resolveExecutable')((root: string, command: string, searchPath: string) => Effect.try({
  try: () => {
    const repository = realpathSync(root);
    const candidates = searchPath.split(delimiter).filter(part => part.length > 0 && isAbsolute(part) && !packagePath(part) && !within(part, repository));
    const trusted: string[] = [];
    for (const entry of candidates) {
      let directory: string;
      try { directory = realpathSync(entry); } catch { continue; }
      if (packagePath(directory) || within(directory, repository)) continue;
      if (!trusted.includes(directory)) trusted.push(directory);
    }
    for (const directory of trusted) {
      try {
        const executable = realpathSync(join(directory, command));
        if (packagePath(executable) || within(executable, repository)) continue;
        accessSync(executable, constants.X_OK);
        return { executable, path: trusted.join(delimiter) };
      } catch { /* Try the next trusted PATH entry. */ }
    }
    return undefined;
  },
  catch: cause => new OwnedProcessError({ operation: 'resolve', detail: cause instanceof Error ? cause.message : String(cause) }),
}));
