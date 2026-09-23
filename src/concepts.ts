// @concord-file
// @concord-implements docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
import { ConcordError, decode, digest, inRepositorySnapshot, objectDigest, type Repository } from './shared.js';
import type { LocalRepository } from './storage.js';
import { ConceptCatalogSchema, type ConceptCatalog, type ConceptDefinition } from './concepts-schema.js';
import { discovered, globalCatalogPath, scopeOf, under } from './writing-scopes.js';
export { ConceptCatalogSchema, type ConceptCatalog, type ConceptDefinition } from './concepts-schema.js';

export const spellingKey = (value: string): string => /^[\x20-\x7e]+$/u.test(value) ? value.toLowerCase() : value;
export function spellingPositions(text: string, spelling: string, allowIn: readonly string[] = []): number[] {
  const ascii = /^[\x20-\x7e]+$/u.test(spelling);
  const flags = ascii ? 'gi' : 'g';
  const expression = new RegExp(spelling.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), flags);
  const allowed: [number, number][] = [];
  for (const word of allowIn) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    for (const match of text.matchAll(new RegExp(escaped, ascii ? 'gi' : 'g'))) allowed.push([match.index, match.index + match[0].length]);
  }
  return [...text.matchAll(expression)].filter(match => {
    const start = match.index, end = start + match[0].length;
    if (ascii && (/[A-Za-z0-9_]/u.test(text[start - 1] ?? '') || /[A-Za-z0-9_]/u.test(text[end] ?? ''))) return false;
    return !allowed.some(([from, to]) => start >= from && end <= to);
  }).map(match => match.index);
}
export function splitReference(reference: string): { path: string; id: string } {
  const at = reference.lastIndexOf('#');
  if (at < 0) throw new ConcordError('InvalidConceptCatalog', `Expected catalog path#id: ${reference}`);
  const path = reference.slice(0, at), id = reference.slice(at + 1);
  scopeOf(path, 'catalog');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)) throw new ConcordError('InvalidConceptCatalog', `Invalid concept reference: ${reference}`);
  return { path, id };
}
export function readConceptCatalog(source: string): ConceptCatalog {
  try {
    const catalog = decode(ConceptCatalogSchema, JSON.parse(source), 'concept catalog');
    const ids = new Set<string>();
    for (const concept of catalog.concepts) {
      if (ids.has(concept.id)) throw new Error(`Duplicate concept ID: ${concept.id}`);
      ids.add(concept.id);
      if (Object.keys(concept.names).length === 0) throw new Error(`${concept.id} needs at least one language`);
      const roles = new Map<string, { role: 'active' | 'deprecated'; preferred: string }>();
      for (const [language, entry] of Object.entries(concept.names)) {
        if (!language.trim() || !entry.preferred.trim()) throw new Error(`${concept.id} has an empty language or preferred name`);
        const local = new Set<string>();
        const spellings: readonly (readonly [string, 'active' | 'deprecated'])[] = [
          [entry.preferred, 'active'], ...(entry.aliases ?? []).map((value): readonly [string, 'active'] => [value, 'active']), ...(entry.deprecated ?? []).map((value): readonly [string, 'deprecated'] => [value, 'deprecated']),
        ];
        for (const [spelling, role] of spellings) {
          if (spelling.trim() !== spelling) throw new Error(`${concept.id} has padded spelling`);
          const key = spellingKey(spelling);
          if (local.has(key)) throw new Error(`${concept.id}/${language} repeats spelling: ${spelling}`);
          local.add(key);
          const earlier = roles.get(key);
          if (earlier && (earlier.role !== role || role === 'deprecated' && spellingKey(earlier.preferred) !== spellingKey(entry.preferred))) throw new Error(`${concept.id} has conflicting cross-language spelling: ${spelling}`);
          roles.set(key, { role, preferred: entry.preferred });
        }
      }
    }
    const imports = new Set<string>();
    for (const reference of catalog.imports ?? []) {
      splitReference(reference);
      if (imports.has(reference)) throw new Error(`Duplicate import: ${reference}`);
      imports.add(reference);
    }
    return catalog;
  } catch (cause) { throw new ConcordError('InvalidConceptCatalog', cause instanceof Error ? cause.message : String(cause)); }
}
export interface CatalogRecord { path: string; scope: string; digest: string; catalog: ConceptCatalog }
export interface ConceptDiagnostic { code: string; message: string; sources: readonly string[]; scope?: string }
export function catalogSources(repo: Repository): Map<string, string> {
  return new Map(discovered(repo, 'catalog').map(path => [path, repo.read(path) ?? '']));
}
export function catalogDependencies(repo: Repository, target: string): { path: string; digest: string }[] {
  scopeOf(target, 'catalog');
  return [...catalogSources(repo)].filter(([path]) => path !== target).map(([path, source]) => ({ path, digest: digest(source) })).sort((a, b) => a.path.localeCompare(b.path));
}
export function analyzeCatalogs(sources: Map<string, string>) {
  const catalogs: CatalogRecord[] = [];
  const diagnostics: ConceptDiagnostic[] = [];
  for (const [path, source] of sources) {
    try { catalogs.push({ path, scope: scopeOf(path, 'catalog'), digest: digest(source), catalog: readConceptCatalog(source) }); }
    catch (cause) { diagnostics.push({ code: 'InvalidConceptCatalog', message: cause instanceof Error ? cause.message : String(cause), sources: [path], scope: scopeOf(path, 'catalog') }); }
  }
  const byPath = new Map(catalogs.map(record => [record.path, record]));
  for (const record of catalogs) for (const reference of record.catalog.imports ?? []) {
    const { path, id } = splitReference(reference);
    if (!byPath.get(path)?.catalog.concepts.some(concept => concept.id === id)) diagnostics.push({ code: 'DanglingConceptImport', message: `${record.path} imports missing ${reference}`, sources: [record.path, reference], scope: record.scope });
  }
  return { catalogs, diagnostics, byPath };
}
export function effectiveConcepts(file: string, catalogs: readonly CatalogRecord[]): { reference: string; path: string; scope: string; concept: ConceptDefinition }[] {
  const byPath = new Map(catalogs.map(record => [record.path, record]));
  const effective = new Map<string, { reference: string; path: string; scope: string; concept: ConceptDefinition }>();
  for (const record of catalogs) {
    if (record.scope !== 'docs' && !under(file, record.scope)) continue;
    for (const concept of record.catalog.concepts) {
      const reference = `${record.path}#${concept.id}`;
      effective.set(reference, { reference, path: record.path, scope: record.scope, concept });
    }
    for (const reference of record.catalog.imports ?? []) {
      const { path, id } = splitReference(reference);
      const owner = byPath.get(path);
      const concept = owner?.catalog.concepts.find(item => item.id === id);
      if (owner && concept) effective.set(reference, { reference, path, scope: owner.scope, concept });
    }
  }
  return [...effective.values()];
}
function ambiguityDiagnostics(catalogs: readonly CatalogRecord[]): ConceptDiagnostic[] {
  const diagnostics: ConceptDiagnostic[] = [];
  const overlapSeen = new Set<string>();
  for (const scope of [...new Set(catalogs.map(record => record.scope))].sort((a, b) => a.length - b.length || a.localeCompare(b))) {
    const names = new Map<string, { reference: string; path: string }[]>();
    for (const item of effectiveConcepts(`${scope}/_scope.md`, catalogs)) for (const entry of Object.values(item.concept.names)) for (const spelling of [entry.preferred, ...(entry.aliases ?? [])]) {
      const key = spellingKey(spelling);
      const owners = names.get(key) ?? [];
      if (!owners.some(owner => owner.reference === item.reference)) owners.push({ reference: item.reference, path: item.path });
      names.set(key, owners);
    }
    for (const [spelling, owners] of names) if (owners.length > 1) {
      const key = `${spelling}:${owners.map(item => item.reference).sort().join('|')}`;
      if (overlapSeen.has(key)) continue;
      overlapSeen.add(key);
      diagnostics.push({ code: 'AmbiguousConceptName', message: `Multiple effective concepts own ${spelling} in ${scope}`, sources: owners.map(item => item.reference), scope });
    }
  }
  return diagnostics;
}
export function indexConcepts(repo: Repository) {
  return inRepositorySnapshot(repo, () => {
    const sources = catalogSources(repo);
    const { catalogs, diagnostics } = analyzeCatalogs(sources);
    return { operation: 'concepts-index', catalogs, concepts: catalogs.flatMap(record => record.catalog.concepts.map(concept => ({ reference: `${record.path}#${concept.id}`, path: record.path, scope: record.scope, concept }))), diagnostics: [...diagnostics, ...ambiguityDiagnostics(catalogs)], inputDigest: objectDigest({ config: repo.configSnapshot.source, sources: [...sources], membership: [...sources.keys()] }) };
  });
}
export function showConcepts(repo: Repository, path = globalCatalogPath) {
  return inRepositorySnapshot(repo, () => {
    const scope = scopeOf(path, 'catalog');
    const source = repo.read(path);
    const analyzed = analyzeCatalogs(catalogSources(repo));
    const projection = { effectiveConcepts: effectiveConcepts(`${scope}/_scope.md`, analyzed.catalogs), diagnostics: [...analyzed.diagnostics, ...ambiguityDiagnostics(analyzed.catalogs)] };
    if (source === undefined) return { operation: 'concepts-show', state: 'missing' as const, path, scope, digest: null, source: null, catalog: null, ...projection };
    try { return { operation: 'concepts-show', state: 'valid' as const, path, scope, digest: digest(source), source, catalog: readConceptCatalog(source), ...projection }; }
    catch (cause) { return { operation: 'concepts-show', state: 'invalid' as const, path, scope, digest: digest(source), source, catalog: null, diagnostic: cause instanceof Error ? cause.message : String(cause), ...projection }; }
  });
}
export function setConcepts(repo: LocalRepository, catalog: ConceptCatalog, expectedDigest: string | null, dryRun = false, path = globalCatalogPath) {
  return inRepositorySnapshot(repo, () => {
    const scope = scopeOf(path, 'catalog');
    const before = repo.read(path) ?? null;
    if ((before === null ? null : digest(before)) !== expectedDigest) throw new ConcordError('PreimageChanged', `${path} changed; retain the draft and reload`);
    const after = `${JSON.stringify(catalog, null, 2)}\n`;
    const validated = readConceptCatalog(after);
    const sources = catalogSources(repo);
    const old = analyzeCatalogs(sources);
    sources.set(path, after);
    const next = analyzeCatalogs(sources);
    const ownIssues = next.diagnostics.filter(item => item.sources[0] === path);
    if (ownIssues.length) throw new ConcordError('InvalidConceptCatalog', ownIssues.map(item => item.message).join('; '));
    const oldIds = new Set(old.byPath.get(path)?.catalog.concepts.map(item => item.id) ?? []);
    const newIds = new Set(validated.concepts.map(item => item.id));
    if ([...oldIds].some(id => !newIds.has(id)) && old.diagnostics.some(item => item.code === 'InvalidConceptCatalog' && item.sources[0] !== path)) throw new ConcordError('ConceptReferencesUnknown', 'Cannot remove a definition while another catalog is malformed');
    for (const record of old.catalogs.filter(item => item.path !== path)) for (const reference of record.catalog.imports ?? []) {
      if (reference.startsWith(`${path}#`) && !newIds.has(splitReference(reference).id)) throw new ConcordError('ConceptInUse', `${reference} is imported by ${record.path}`);
    }
    const dependencies = catalogDependencies(repo, path);
    const receipt = repo.publish('set-concepts', [{ path, before, after }], dryRun, dependencies);
    return { ...receipt, catalog: validated, source: after, digest: digest(after), path, scope };
  });
}
