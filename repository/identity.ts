import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/** Hash the actual installed engine, independent of its absolute installation path. */
export function repositoryImplementationDigest(directory = dirname(fileURLToPath(import.meta.url))): string {
  const entries: [string, string][] = [];
  const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name); const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error('Repository engine cannot contain symbolic links');
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile() && name.endsWith('.js')) entries.push([relative(directory, path), hash(path)]);
    }
  };
  walk(directory);
  // Shared policy and document lifecycle code live alongside repository/.
  // Both entry points must use the same complete governance engine.
  const sharedDirectory = dirname(directory);
  for (const name of readdirSync(sharedDirectory).sort()) {
    const path = join(sharedDirectory, name);
    const stat = lstatSync(path);
    if (!name.endsWith('.js')) continue;
    if (stat.isSymbolicLink()) throw new Error('Repository engine cannot contain symbolic links');
    if (stat.isFile()) entries.push([relative(directory, path), hash(path)]);
  }
  for (const name of ['package.json', 'npm-shrinkwrap.json']) entries.push([name, hash(resolve(directory, '../..', name))]);
  return 'sha256:' + createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}
