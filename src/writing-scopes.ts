// @concord-file
// @concord-implements docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
import { dirname } from 'node:path';
import { ConcordError, inRepositorySnapshot, objectDigest, type Repository } from './shared.js';
import { canonicalPath } from './storage.js';

export const policyName = 'concord-writing.json';
export const catalogName = 'concepts.json';
export const globalPolicyPath = `docs/${policyName}`;
export const globalCatalogPath = `docs/${catalogName}`;

export function scopeOf(path: string, kind: 'policy' | 'catalog'): string {
  canonicalPath(path);
  const name = kind === 'policy' ? policyName : catalogName;
  const scope = dirname(path);
  if (scope !== 'docs' && !scope.startsWith('docs/')) throw new ConcordError('InvalidWritingPath', `Managed ${kind} must be under docs: ${path}`);
  if (path !== `${scope}/${name}` || path.split('/').some(part => part === '_template' || part === '.git' || part === 'node_modules')) throw new ConcordError('InvalidWritingPath', `Unrecognized managed ${kind} owner: ${path}`);
  return scope;
}

export const under = (path: string, root: string): boolean => path === root || path.startsWith(`${root}/`);
export const applies = (path: string, scope: string): boolean => scope === 'docs' || under(path, scope);
export function discovered(repo: Repository, kind: 'policy' | 'catalog'): string[] {
  const name = kind === 'policy' ? policyName : catalogName;
  return repo.files('docs').filter(path => path.endsWith(`/${name}`) && path.split('/').every(part => part !== '_template' && part !== '.git' && part !== 'node_modules')).sort();
}
export function indexWritingScopes(repo: Repository) {
  return inRepositorySnapshot(repo, () => {
    const policies = new Set(discovered(repo, 'policy'));
    const catalogs = new Set(discovered(repo, 'catalog'));
    const scopes = new Set(['docs', ...[...policies, ...catalogs].map(dirname)]);
    return { operation: 'writing-index', scopes: [...scopes].sort().map(scope => ({ scope, policyPath: `${scope}/${policyName}`, catalogPath: `${scope}/${catalogName}`, hasPolicy: policies.has(`${scope}/${policyName}`), hasCatalog: catalogs.has(`${scope}/${catalogName}`) })) };
  });
}
export function snapshotDigest(inputs: readonly [string, string][], memberships: readonly [string, readonly string[]][]): string {
  return objectDigest({ inputs: [...inputs].sort(([a], [b]) => a.localeCompare(b)), memberships: [...memberships].sort(([a], [b]) => a.localeCompare(b)) });
}
