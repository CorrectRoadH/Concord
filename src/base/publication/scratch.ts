import { closeSync, constants, fchmodSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { Effect } from 'effect';
import { ConcordError, failure } from '../../model/index.ts';
import { ensureGenericPrivateDirectorySync, genericPrivateDirectorySync } from './coordination.ts';

export interface PublicationScratch {
  readonly path: string;
  readonly preserve: () => void;
  readonly remove: Effect.Effect<void, ConcordError>;
  readonly child: (name: string) => Effect.Effect<string, ConcordError>;
}

function temporaryParent(root: string): string {
  const directory = resolve(tmpdir());
  const repository = resolve(root);
  if (directory === repository || directory.startsWith(`${repository}${sep}`)) throw new ConcordError('UnsafePath', 'Verification temporary directory must be outside the repository');
  for (let path = directory; ; path = dirname(path)) {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ConcordError('UnsafePath', `Temporary directory ancestor is not a real directory: ${path}`);
    if (dirname(path) === path) return directory;
  }
}

/** An unconfirmed process cleanup must preserve its report/worktree directory. */
export const scratchDirectory = Effect.fn('Publication.scratchDirectory')(function*(root: string, namespace: string, prefix: string, location?: 'temporary') {
  let preserved = false;
  return yield* Effect.acquireRelease(Effect.try({ try: (): PublicationScratch => {
    if (namespace.split('/').some(part => part === '..' || part === '.') || /[\\\0]/u.test(namespace) || !/^[a-z0-9-]+$/u.test(prefix)) throw new ConcordError('UnsafePath', 'Invalid private scratch name');
    if (location === 'temporary' && namespace !== '') throw new ConcordError('UnsafePath', 'Temporary scratch roots cannot use a shared namespace');
    const privateDir = location === 'temporary' ? temporaryParent(root) : genericPrivateDirectorySync(root);
    if (location !== 'temporary') ensureGenericPrivateDirectorySync(root, privateDir);
    let directory = privateDir;
    for (const part of namespace.split('/').filter(Boolean)) {
      directory = join(directory, part);
      if (lstatSync(directory, { throwIfNoEntry: false })?.isSymbolicLink()) throw new ConcordError('UnsafePath', `Verification directory is a symlink: ${directory}`);
      mkdirSync(directory, { recursive: true, mode: 0o700 });
    }
    const path = mkdtempSync(join(directory, prefix));
    const identity = lstatSync(path);
    const assertOwned = () => {
      temporaryParent(root);
      const current = lstatSync(path, { throwIfNoEntry: false });
      if (current === undefined) return false;
      if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino || current.uid !== userInfo().uid || (current.mode & 0o777) !== 0o700) throw new ConcordError('UnsafePath', `Verification scratch ownership changed; preserve ${path}`);
      return true;
    };
    if (location === 'temporary') {
      try {
        const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        try {
          const opened = fstatSync(fd);
          if (!opened.isDirectory() || opened.dev !== identity.dev || opened.ino !== identity.ino || opened.uid !== userInfo().uid) throw new ConcordError('UnsafePath', `Verification scratch is not owned by the current user: ${path}`);
          fchmodSync(fd, 0o700);
        } finally { closeSync(fd); }
        assertOwned();
      } catch (cause) {
        const current = lstatSync(path, { throwIfNoEntry: false });
        if (current?.isDirectory() && !current.isSymbolicLink() && current.dev === identity.dev && current.ino === identity.ino && current.uid === userInfo().uid) rmSync(path, { recursive: true, force: true });
        throw cause;
      }
    }
    const remove = Effect.try({ try: () => { if (location !== 'temporary' || assertOwned()) rmSync(path, { recursive: true, force: true }); }, catch: failure });
    return { path, preserve: () => { preserved = true; }, remove,
      child: name => Effect.try({ try: () => {
        if (!/^[A-Za-z0-9_-]+$/u.test(name)) throw new ConcordError('UnsafePath', 'Invalid report directory name');
        const target = join(path, name); mkdirSync(target, { mode: 0o700 }); return target;
      }, catch: failure }),
    };
  }, catch: failure }), scratch => preserved ? Effect.void : scratch.remove.pipe(Effect.orDie));
});
