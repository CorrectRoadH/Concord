import { ConcordError } from "../../model/shared.js";
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isDocumentName } from "../../model/index.js";
import { validPackagePath } from "../../model/index.js";
import { resolveDesignPlanPath } from "../../model/index.js";


/** Callers observe the containing collection in their source snapshot before reading. */
export function readDesignPlanPaths(root: string, base: string, alternatives?: readonly string[]): ReadonlyMap<string, string> {
  if (!validPackagePath('design', `${base}/README.md`)) throw new ConcordError('InvalidPlacement', base);
  const directory = (path: string) => {
    let current = root;
    for (const part of path.split('/')) {
      current = join(current, part);
      const stat = lstatSync(current, { throwIfNoEntry: false });
      if (stat === undefined) return [];
      if (stat.isSymbolicLink()) throw new ConcordError('UnsafePath', `Symlink in Plan path: ${path}`);
      if (!stat.isDirectory()) throw new ConcordError('InvalidPlan', `Expected directory: ${path}`);
    }
    return readdirSync(current, { withFileTypes: true });
  };
  const paths = new Set<string>();
  const names = new Set<string>();
  const discovered: string[] = [];
  for (const entry of directory(`${base}/plans`)) {
    const name = entry.isDirectory() ? entry.name : entry.name.endsWith('.md') ? entry.name.slice(0, -3) : '';
    const key = name.normalize('NFC').toLowerCase();
    if (names.has(key) && !discovered.includes(name)) throw new ConcordError('InvalidPlan', `Colliding Plan name: ${entry.name}`);
    names.add(key);
    if (entry.isSymbolicLink()) throw new ConcordError('UnsafePath', `Symlink in plans: ${entry.name}`);
    if (!isDocumentName(name) || name.toLowerCase() === 'readme' || alternatives !== undefined && !alternatives.includes(name) || !entry.isDirectory() && !entry.isFile()) throw new ConcordError('InvalidPlan', `Invalid Plan member: ${base}/plans/${entry.name}`);
    discovered.push(name);
    paths.add(`${base}/plans/${entry.name}`);
    if (entry.isDirectory()) {
      const readme = directory(`${base}/plans/${entry.name}`).find(child => child.name === 'README.md');
      if (readme !== undefined) {
        if (!readme.isFile()) throw new ConcordError(readme.isSymbolicLink() ? 'UnsafePath' : 'InvalidPlan', `Invalid Plan README: ${entry.name}`);
        paths.add(`${base}/plans/${entry.name}/README.md`);
      }
    }
  }
  return new Map((alternatives ?? discovered.sort()).map(name => [name, resolveDesignPlanPath(base, name, path => paths.has(path))]));
}
