import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { Effect } from 'effect';
import { ConcordError } from '../../model/index.js';

export type UntrackedFile = { readonly kind: 'symlink' } | { readonly kind: 'other' } | { readonly kind: 'over-limit' }
  | { readonly kind: 'file'; readonly bytes: Buffer; readonly mode: number };

/** Git names may contain control characters; validate containment without changing the name. */
export const untrackedFile = Effect.fn('Sources.untrackedFile')((root: string, path: string, limit: number) => Effect.try({
  try: (): UntrackedFile => {
    const base = resolve(root), target = resolve(base, path);
    if (!target.startsWith(base + sep) || path.split('/').some(segment => segment === '..' || segment === '.git')) throw new ConcordError('UnsafePath', 'The Git path is outside the working tree.');
    let current = base;
    for (const segment of path.split('/')) {
      current = join(current, segment);
      if (lstatSync(current).isSymbolicLink()) return { kind: 'symlink' };
    }
    const before = lstatSync(target);
    if (!before.isFile()) return { kind: 'other' };
    if (before.size > limit) return { kind: 'over-limit' };
    const fd = openSync(target, constants.O_RDONLY | constants.O_NONBLOCK | (process.platform === 'darwin' ? 0x20000000 : constants.O_NOFOLLOW));
    try {
      const opened = fstatSync(fd);
      if (!opened.isFile() || opened.ino !== before.ino || opened.dev !== before.dev || opened.size > limit) throw new Error('changed');
      const bytes = readFileSync(fd), after = fstatSync(fd), linked = lstatSync(target);
      if (linked.isSymbolicLink() || linked.ino !== opened.ino || linked.dev !== opened.dev || after.size !== bytes.length || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw new Error('changed');
      return { kind: 'file', bytes, mode: opened.mode };
    } finally { closeSync(fd); }
  },
  catch: cause => cause instanceof ConcordError ? cause : new ConcordError('GitReadFailed', 'The new file changed or cannot be read; refresh the panel.'),
}));
