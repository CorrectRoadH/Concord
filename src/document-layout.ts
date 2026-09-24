// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
import { DOCUMENT_NAME_PATTERN } from './document-name.js';
import type { DocumentKind } from './shared.js';

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
  return parts.length === 6 && validPackagePath('design', `${parts.slice(0, 3).join('/')}/README.md`) && parts[3] === 'plans' && isDocumentName(parts[4]!) && parts[5] === 'README.md';
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
