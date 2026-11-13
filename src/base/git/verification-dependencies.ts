// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#修复核验
import { lstatSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ConcordError, canonical } from '../../model/index.ts';
import type { ProcessDiagnostic } from '../process/index.ts';

const stateFiles = ['.modules.yaml', '.package-lock.json', '.yarn-state.yml', '.pnpm-workspace-state-v1.json', 'pyvenv.cfg'];
function fingerprint(directory: string): ReadonlyMap<string, string> {
  const entries = new Map<string, string>();
  const own = lstatSync(directory, { throwIfNoEntry: false });
  entries.set('.', own === undefined ? 'absent' : canonical({ size: own.size, mtime: own.mtimeMs }));
  const target = statSync(directory, { throwIfNoEntry: false });
  if (target?.isDirectory()) {
    for (const name of readdirSync(directory).sort()) entries.set(name, 'present');
    for (const name of stateFiles) {
      const stat = lstatSync(join(directory, name), { throwIfNoEntry: false });
      if (stat) entries.set(name, canonical({ size: stat.size, mtime: stat.mtimeMs }));
    }
  }
  return entries;
}

/** Metadata only, with exactly the boundary declared by the verification Spec. */
export function dependencyProcessGuard(directories: readonly string[]) {
  return { capture: () => {
    const before = directories.map(path => ({ path, entries: fingerprint(path) }));
    return (process: ProcessDiagnostic) => {
      const changed = before.flatMap(({ path, entries }) => {
        const after = fingerprint(path);
        const names = [...new Set([...entries.keys(), ...after.keys()])].filter(name => entries.get(name) !== after.get(name));
        return names.length ? [{ path, entries: names }] : [];
      });
      if (changed.length) throw new ConcordError('DependenciesModified', `Borrowed dependencies were modified: ${changed.map(item => `${item.path} (${item.entries.join(', ')})`).join('; ')}. Reinstall the main worktree dependencies before retrying.`, { directories: changed, process });
    };
  } };
}
