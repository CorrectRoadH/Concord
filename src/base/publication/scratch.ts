import { lstatSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { ConcordError, failure } from '../../model/index.js';
import { ensureGenericPrivateDirectorySync, genericPrivateDirectorySync } from './coordination.js';

export interface PublicationScratch {
  readonly path: string;
  readonly preserve: () => void;
  readonly remove: Effect.Effect<void, ConcordError>;
  readonly child: (name: string) => Effect.Effect<string, ConcordError>;
}

/** An unconfirmed process cleanup must preserve its report/worktree directory. */
export const scratchDirectory = Effect.fn('Publication.scratchDirectory')(function*(root: string, namespace: string, prefix: string) {
  let preserved = false;
  return yield* Effect.acquireRelease(Effect.try({ try: (): PublicationScratch => {
    if (namespace.split('/').some(part => part === '..' || part === '.') || /[\\\0]/u.test(namespace) || !/^[a-z0-9-]+$/u.test(prefix)) throw new ConcordError('UnsafePath', 'Invalid private scratch name');
    const privateDir = genericPrivateDirectorySync(root);
    ensureGenericPrivateDirectorySync(root, privateDir);
    let directory = privateDir;
    for (const part of namespace.split('/').filter(Boolean)) {
      directory = join(directory, part);
      if (lstatSync(directory, { throwIfNoEntry: false })?.isSymbolicLink()) throw new ConcordError('UnsafePath', `Verification directory is a symlink: ${directory}`);
      mkdirSync(directory, { recursive: true, mode: 0o700 });
    }
    const path = mkdtempSync(join(directory, prefix));
    const remove = Effect.try({ try: () => { rmSync(path, { recursive: true, force: true }); }, catch: failure });
    return { path, preserve: () => { preserved = true; }, remove,
      child: name => Effect.try({ try: () => {
        if (!/^[A-Za-z0-9_-]+$/u.test(name)) throw new ConcordError('UnsafePath', 'Invalid report directory name');
        const target = join(path, name); mkdirSync(target, { mode: 0o700 }); return target;
      }, catch: failure }),
    };
  }, catch: failure }), scratch => preserved ? Effect.void : scratch.remove.pipe(Effect.orDie));
});
