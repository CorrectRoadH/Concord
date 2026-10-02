// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
import { DOCUMENT_NAME_PATTERN } from './document-name.js';
import { ConcordError, type DocumentKind } from './shared.js';
import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const DOCUMENT_ROOTS = ['docs/feature', 'docs/roadmap', 'docs/design', 'docs/research', 'docs/engineering', 'docs/issues'] as const;
export const isDocumentName = (name: string): boolean => DOCUMENT_NAME_PATTERN.test(name);
export const inDocumentRoot = (path: string, root: string): boolean => path.startsWith(`${root}/`);
export type PackageKind = 'feature' | 'roadmap' | 'design' | 'engineering';

/** Defaults for new owners only. Existing owners are always located by their source path. */
export function defaultDocumentPath(kind: Exclude<DocumentKind, 'memory'>, name: string, featurePath?: string): string {
  if (!isDocumentName(name)) throw new Error(`Unsafe document name: ${name}`);
  if (kind === 'use-case') {
    if (featurePath === undefined || !validPackagePath('feature', featurePath)) throw new Error('Expected a Feature owner path');
    return `${featurePath.slice(0, -'README.md'.length)}use-case/${name}.md`;
  }
  return kind === 'issue' ? `docs/issues/${name}.md` : `docs/${kind}/${name}/README.md`;
}

export function validPackagePath(kind: PackageKind, path: string): boolean {
  const parts = path.split('/');
  return parts.length === 4 && parts[0] === 'docs' && parts[1] === kind && isDocumentName(parts[2]!) && parts[3] === 'README.md';
}

export function validLeafPath(root: string, path: string): boolean {
  if (!inDocumentRoot(path, root)) return false;
  const leaf = path.slice(root.length + 1);
  return leaf.endsWith('.md') && isDocumentName(leaf.slice(0, -3));
}

export function validDesignPlanPath(path: string): boolean {
  const parts = path.split('/');
  return validPackagePath('design', `${parts.slice(0, 3).join('/')}/README.md`) && parts[3] === 'plans' &&
    (parts.length === 6 && isDocumentName(parts[4]!) && parts[5] === 'README.md' || parts.length === 5 && parts[4]!.endsWith('.md') && isDocumentName(parts[4]!.slice(0, -3)));
}

export function designPlanName(path: string): string {
  if (!validDesignPlanPath(path)) throw new ConcordError('InvalidPlan', `Invalid Plan entry: ${path}`);
  return path.endsWith('/README.md') ? path.split('/').at(-2)! : path.split('/').at(-1)!.slice(0, -3);
}

export function designPlanCandidates(base: string, name: string): readonly [string, string] {
  return [`${base}/plans/${name}.md`, `${base}/plans/${name}/README.md`];
}

/** Presence comes from exact directory names, never case-insensitive path lookup. */
export function resolveDesignPlanPath(base: string, name: string, present: (path: string) => boolean): string {
  if (!isDocumentName(name) || name.toLowerCase() === 'readme') throw new ConcordError('InvalidPlan', `Invalid or reserved Plan name: ${name}`);
  const [file, readme] = designPlanCandidates(base, name);
  if (present(file) && (present(`${base}/plans/${name}`) || present(readme))) throw new ConcordError('AmbiguousDesignPlan', `${name} has both file and directory forms`);
  if (present(file)) return file;
  if (present(readme)) return readme;
  throw new ConcordError('DesignPlanNotFound', `${name} requires ${file} or ${readme}`);
}

/** Callers observe the containing collection in their source snapshot before reading. */
export function readDesignPlanPaths(root: string, base: string, alternatives: readonly string[]): ReadonlyMap<string, string> {
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
  for (const entry of directory(`${base}/plans`)) {
    const key = entry.name.normalize('NFC').toLowerCase();
    if (names.has(key)) throw new ConcordError('InvalidPlan', `Colliding Plan path: ${entry.name}`);
    names.add(key);
    const name = entry.isDirectory() ? entry.name : entry.name.endsWith('.md') ? entry.name.slice(0, -3) : '';
    if (entry.isSymbolicLink()) throw new ConcordError('UnsafePath', `Symlink in plans: ${entry.name}`);
    if (!alternatives.includes(name) || !entry.isDirectory() && !entry.isFile()) throw new ConcordError('InvalidPlan', `Undeclared or invalid Plan member: ${base}/plans/${entry.name}`);
    paths.add(`${base}/plans/${entry.name}`);
    if (entry.isDirectory()) {
      const readme = directory(`${base}/plans/${entry.name}`).find(child => child.name === 'README.md');
      if (readme !== undefined) {
        if (!readme.isFile()) throw new ConcordError(readme.isSymbolicLink() ? 'UnsafePath' : 'InvalidPlan', `Invalid Plan README: ${entry.name}`);
        paths.add(`${base}/plans/${entry.name}/README.md`);
      }
    }
  }
  return new Map(alternatives.map(name => [name, resolveDesignPlanPath(base, name, path => paths.has(path))]));
}

export function documentPlacementError(kind: DocumentKind, path: string, featurePath?: string): string | undefined {
  if (kind === 'memory') return undefined;
  if (kind === 'research') return /^docs\/research(?:\/[^/]+)+\/README\.md$/u.test(path) && !path.includes('..') ? undefined : 'Research owners must retain a safe topic path below docs/research with README.md';
  if (kind === 'use-case') {
    if (featurePath === undefined || !validPackagePath('feature', featurePath)) return 'Use Case requires an existing canonical Feature owner';
    const root = `${featurePath.slice(0, -'/README.md'.length)}/use-case`;
    return validLeafPath(root, path) ? undefined : `Expected a safe Unicode .md filename directly below ${root}; the filename is independent of the document ID`;
  }
  const valid = kind === 'issue' ? validLeafPath('docs/issues', path) : validPackagePath(kind, path);
  return valid ? undefined : `Expected ${kind === 'issue' ? 'docs/issues/<name>.md' : `docs/${kind}/<name>/README.md`}, with a safe Unicode name independent of the document ID`;
}

export function documentDisposition(kind: DocumentKind, path: string, memoryRoots: readonly string[]): 'current' | 'historical' | 'unmanaged' {
  if (DOCUMENT_ROOTS.some(root => inDocumentRoot(path, root))) return 'current';
  if (memoryRoots.some(root => inDocumentRoot(path, root))) return kind === 'memory' ? 'current' : 'historical';
  return 'unmanaged';
}

export interface NamedOwner { readonly path: string; readonly metadata: { readonly id: string; readonly kind: DocumentKind } }
/** Paths are exact identities; a short ID is usable only when it has one match. */
export function matchingOwners<A extends NamedOwner>(owners: readonly A[], selector: string, kind?: DocumentKind): readonly A[] {
  const pool = kind === undefined ? owners : owners.filter(owner => owner.metadata.kind === kind);
  const exact = pool.filter(owner => owner.path === selector);
  return exact.length > 0 ? exact : pool.filter(owner => owner.metadata.id === selector);
}
