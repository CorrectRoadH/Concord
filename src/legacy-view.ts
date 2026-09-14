// @concord-file legacy-niceeval-view-projection
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import { Predicate, Result, Schema, SchemaIssue } from 'effect';
import { parseDocument } from 'yaml';
import { ConcordError, digest, type Finding, type Repository } from './shared.js';
import type { LegacyViewDocument, ViewFile } from './view-contract.js';

const LEGACY_FORMAT = 'niceeval.docs-node/v1' as const;
const LEGACY_KINDS = ['feature', 'roadmap', 'engineering', 'design', 'design-plan', 'use-case'] as const;
type LegacyKind = typeof LEGACY_KINDS[number];
const LegacyNodeSchema = Schema.Struct({
  format: Schema.Literal(LEGACY_FORMAT),
  kind: Schema.Literals(LEGACY_KINDS),
  relations: Schema.optional(Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Array(Schema.String)]))),
});

interface LegacyNode {
  readonly path: string;
  readonly kind: LegacyKind;
  readonly title: string;
  readonly body: string;
  readonly source: string;
  readonly relations: Readonly<Record<string, readonly string[]>>;
}

export interface LegacyViewInventory {
  readonly documents: readonly LegacyViewDocument[];
  readonly readOnlyPaths: ReadonlySet<string>;
  readonly pageOwners: ReadonlyMap<string, string>;
  readonly findings: readonly Finding[];
}

const RepositoryProfileMarkerSchema = Schema.Struct({
  format: Schema.Literal('concord.repository/v1'),
  host: Schema.String,
});

const LEGACY_REASON = 'Legacy NiceEval content is read-only in Concord. Edit the original NiceEval source with its repository tools.';

function frontmatter(path: string, source: string): { readonly value: unknown; readonly body: string } | undefined {
  if (!/^---\r?\n/u.test(source)) return undefined;
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/u.exec(source);
  if (match === null || match[1] === undefined || match[2] === undefined) {
    if (/(?:^|\n)format:\s*niceeval\.docs-node\/v1(?:\s|$)/u.test(source.slice(0, 64 * 1024))) {
      throw new ConcordError('InvalidData', `${path}: unterminated NiceEval frontmatter`);
    }
    return undefined;
  }
  const yaml = parseDocument(match[1], { uniqueKeys: true, merge: false });
  if (yaml.errors.length > 0) {
    if (/(?:^|\n)format:\s*niceeval\.docs-node\/v1(?:\s|$)/u.test(match[1])) {
      throw new ConcordError('InvalidData', `${path}: ${yaml.errors.map(error => error.message).join('; ')}`);
    }
    return undefined;
  }
  return { value: yaml.toJS({ maxAliasCount: 0 }), body: match[2] };
}

function heading(body: string, fallback: string): string {
  return /^#\s+(.+)$/mu.exec(body)?.[1]?.trim() || fallback;
}

function decodeNode(path: string, source: string): LegacyNode | undefined {
  const parsed = frontmatter(path, source);
  if (parsed === undefined || !Predicate.isObject(parsed.value) || parsed.value.format !== LEGACY_FORMAT) return undefined;
  const decoded = Schema.decodeUnknownResult(LegacyNodeSchema, { errors: 'all', onExcessProperty: 'error' })(parsed.value);
  if (Result.isFailure(decoded)) {
    throw new ConcordError('InvalidData', `${path}: ${SchemaIssue.makeFormatterDefault()(decoded.failure.issue)}`);
  }
  const relations: Record<string, readonly string[]> = {};
  for (const [name, value] of Object.entries(decoded.success.relations ?? {})) {
    relations[name] = Array.isArray(value) ? [...value] : [value];
  }
  return { path, kind: decoded.success.kind, title: heading(parsed.body, path), body: parsed.body, source, relations };
}

function directoryOfOwner(path: string): string {
  return path.endsWith('/README.md') ? path.slice(0, -'README.md'.length) : `${path.slice(0, -'.md'.length)}/`;
}

function deepestFeature(nodes: readonly LegacyNode[], path: string): LegacyNode | undefined {
  return nodes
    .filter(node => node.kind === 'feature' && path.startsWith(directoryOfOwner(node.path)))
    .sort((left, right) => directoryOfOwner(right.path).length - directoryOfOwner(left.path).length)[0];
}

function useCaseRoot(node: LegacyNode): string {
  return node.path.endsWith('/README.md') ? directoryOfOwner(node.path) : `${node.path.slice(0, -'.md'.length)}/`;
}

function deepestUseCase(nodes: readonly LegacyNode[], path: string): LegacyNode | undefined {
  return nodes
    .filter(node => node.kind === 'use-case' && path.startsWith(useCaseRoot(node)))
    .sort((left, right) => useCaseRoot(right).length - useCaseRoot(left).length)[0];
}

function deepestLegacyOwner(nodes: readonly LegacyNode[], path: string): LegacyNode | undefined {
  return nodes
    .filter(node => path.startsWith(directoryOfOwner(node.path)))
    .sort((left, right) => directoryOfOwner(right.path).length - directoryOfOwner(left.path).length)[0];
}

function isCrossFeature(node: LegacyNode): boolean {
  return node.kind === 'use-case' &&
    (node.relations.composes !== undefined || node.path.startsWith('docs/feature/use-case/'));
}

function supportsProjection(node: LegacyNode): node is LegacyNode & { readonly kind: 'feature' | 'use-case' } {
  return node.kind === 'feature' || node.kind === 'use-case';
}

/**
 * Read only static parser for the old NiceEval docs marker. This function does
 * not import repository code, inspect a host, or compile repository trace.
 */
export function inspectLegacyView(repo: Repository): LegacyViewInventory {
  const profile = repo.read('concord.repository.json');
  if (profile === undefined) return { documents: [], readOnlyPaths: new Set(), pageOwners: new Map(), findings: [] };
  try {
    const value: unknown = JSON.parse(profile);
    Schema.decodeUnknownSync(RepositoryProfileMarkerSchema, { onExcessProperty: 'error' })(value);
  } catch {
    return { documents: [], readOnlyPaths: new Set(), pageOwners: new Map(), findings: [] };
  }
  const markdown = repo.files('docs').filter(path => path.endsWith('.md')).sort();
  const nodes: LegacyNode[] = [];
  const readOnlyPaths = new Set<string>();
  const findings: Finding[] = [];
  for (const path of markdown) {
    const source = repo.read(path);
    if (source === undefined) continue;
    try {
      const node = decodeNode(path, source);
      if (node === undefined) continue;
      nodes.push(node);
      readOnlyPaths.add(path);
    } catch (cause) {
      const error = cause instanceof ConcordError ? cause : new ConcordError('InvalidData', String(cause));
      readOnlyPaths.add(path);
      findings.push({ code: error.code, path, message: error.message });
    }
  }

  const documents = nodes.filter(supportsProjection).map((node): LegacyViewDocument => {
    const feature = node.kind === 'feature' || isCrossFeature(node) ? undefined : deepestFeature(nodes, node.path);
    return {
      format: LEGACY_FORMAT,
      kind: node.kind,
      path: node.path,
      title: node.title,
      body: node.source,
      digest: digest(repo.read(node.path) ?? ''),
      readOnly: true,
      reason: LEGACY_REASON,
      ...(feature === undefined ? {} : { featurePath: feature.path }),
      relations: node.relations,
    };
  }).sort((left, right) => left.path.localeCompare(right.path));

  const pageOwners = new Map<string, string>();
  for (const path of markdown) {
    if (readOnlyPaths.has(path)) continue;
    const useCase = deepestUseCase(nodes, path);
    if (useCase !== undefined) {
      pageOwners.set(path, useCase.path);
      continue;
    }
    const owner = deepestLegacyOwner(nodes, path);
    if (owner !== undefined) pageOwners.set(path, owner.path);
  }
  return {
    documents,
    readOnlyPaths,
    pageOwners,
    findings: findings.sort((left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code)),
  };
}

export function applyLegacyPageOwnership(pages: readonly ViewFile[], inventory: LegacyViewInventory): ViewFile[] {
  return pages.map(page => {
    const owner = inventory.pageOwners.get(page.path);
    if (!inventory.readOnlyPaths.has(page.path) && owner === undefined) return page;
    return { ...page, readOnly: true, reason: LEGACY_REASON, ...(owner === undefined ? {} : { documentPath: owner }) };
  });
}

export function legacyViewFile(inventory: LegacyViewInventory, path: string): ViewFile | undefined {
  const document = inventory.documents.find(item => item.path === path);
  if (document !== undefined) return document;
  return undefined;
}

export { LEGACY_REASON };
