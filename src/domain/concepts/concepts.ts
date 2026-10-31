import { selectEffectiveConcepts, splitConceptReference } from '../../model/index.js';
import { ConcordError, digest, inRepositorySnapshot, objectDigest, type Repository } from "../../model/index.js";
import type { LocalRepository } from "../../base/workspace/index.js";
import { fromMarkdown } from "../../model/index.js";
import { documentMarkdown } from "../documents/index.js";
import { parseConceptCatalog, conceptSpellingKey, type ConceptCatalog, type ConceptDefinition } from "../../model/index.js";
import { discovered, globalCatalogPath, scopeOf, under } from "../../model/index.js";


// @concord-begin
// @concord-implements docs/feature/documentation-quality/policy.md#概念定义
export const spellingKey = conceptSpellingKey;
const spellingExpressions = new Map<string, RegExp>();
function spellingExpression(spelling: string, ascii: boolean): RegExp {
  const flags = ascii ? 'gi' : 'g', key = `${flags}:${spelling}`;
  let expression = spellingExpressions.get(key);
  if (expression === undefined) {
    expression = new RegExp(spelling.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), flags);
    if (spellingExpressions.size >= 1024) spellingExpressions.delete(spellingExpressions.keys().next().value!);
    spellingExpressions.set(key, expression);
  }
  return expression;
}
export function spellingPositions(text: string, spelling: string, allowIn: readonly string[] = []): number[] {
  const ascii = /^[\x20-\x7e]+$/u.test(spelling);
  const expression = spellingExpression(spelling, ascii);
  const allowed: [number, number][] = [];
  for (const word of allowIn) {
    for (const match of text.matchAll(spellingExpression(word, ascii))) allowed.push([match.index, match.index + match[0].length]);
  }
  return [...text.matchAll(expression)].filter(match => {
    const start = match.index, end = start + match[0].length;
    if (ascii && (/[A-Za-z0-9_]/u.test(text[start - 1] ?? '') || /[A-Za-z0-9_]/u.test(text[end] ?? ''))) return false;
    return !allowed.some(([from, to]) => start >= from && end <= to);
  }).map(match => match.index);
}
export function splitReference(reference: string): { path: string; id: string } {
  return splitConceptReference(reference);
}

export function readConceptCatalog(source: string, path?: string): ConceptCatalog {
  try { return parseConceptCatalog(source, path === undefined ? fromMarkdown : () => documentMarkdown(path, source)); }
  catch (cause) { throw new ConcordError('InvalidConceptCatalog', cause instanceof Error ? cause.message : String(cause)); }
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
    try { catalogs.push({ path, scope: scopeOf(path, 'catalog'), digest: digest(source), catalog: readConceptCatalog(source, path) }); }
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
  return selectEffectiveConcepts(file, catalogs);
}

function ambiguityDiagnostics(catalogs: readonly CatalogRecord[]): ConceptDiagnostic[] {
  const diagnostics: ConceptDiagnostic[] = [];
  const overlapSeen = new Set<string>();
  for (const scope of [...new Set(catalogs.map(record => record.scope))].sort((a, b) => a.length - b.length || a.localeCompare(b))) {
    const names = new Map<string, { reference: string; path: string }[]>();
    for (const item of effectiveConcepts(`${scope}/_scope.md`, catalogs)) {
      const spelling = item.concept.term;
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
// @concord-end
// @concord-code
// @concord-implements docs/feature/documentation-quality/policy.md#使用统计与输入快照
export function indexConcepts(repo: Repository) {
  return inRepositorySnapshot(repo, () => {
    const sources = catalogSources(repo);
    const { catalogs, diagnostics } = analyzeCatalogs(sources);
    return { operation: 'concepts-index', catalogs, concepts: catalogs.flatMap(record => record.catalog.concepts.map(concept => ({ reference: `${record.path}#${concept.id}`, path: record.path, scope: record.scope, concept }))), diagnostics: [...diagnostics, ...ambiguityDiagnostics(catalogs)], inputDigest: objectDigest({ config: repo.configSnapshot.source, sources: [...sources], membership: [...sources.keys()] }) };
  });
}
// @concord-code
// @concord-implements docs/feature/documentation-quality/policy.md#概念定义
export function showConcepts(repo: Repository, path = globalCatalogPath) {
  return inRepositorySnapshot(repo, () => {
    const scope = scopeOf(path, 'catalog');
    const source = repo.read(path);
    const analyzed = analyzeCatalogs(catalogSources(repo));
    const projection = { effectiveConcepts: effectiveConcepts(`${scope}/_scope.md`, analyzed.catalogs), diagnostics: [...analyzed.diagnostics, ...ambiguityDiagnostics(analyzed.catalogs)] };
    if (source === undefined) return { operation: 'concepts-show', state: 'missing' as const, path, scope, digest: null, source: null, catalog: null, ...projection };
    try { return { operation: 'concepts-show', state: 'valid' as const, path, scope, digest: digest(source), source, catalog: readConceptCatalog(source, path), ...projection }; }
    catch (cause) { return { operation: 'concepts-show', state: 'invalid' as const, path, scope, digest: digest(source), source, catalog: null, diagnostic: cause instanceof Error ? cause.message : String(cause), ...projection }; }
  });
}
// @concord-code
// @concord-implements docs/feature/documentation-quality/policy.md#工具管理与恢复
export function setConcepts(repo: LocalRepository, source: string, expectedDigest: string | null, dryRun = false, path = globalCatalogPath) {
  return inRepositorySnapshot(repo, () => {
    const scope = scopeOf(path, 'catalog');
    const before = repo.read(path) ?? null;
    if ((before === null ? null : digest(before)) !== expectedDigest) throw new ConcordError('PreimageChanged', `${path} changed; retain the draft and reload`);
    const after = source;
    const validated = readConceptCatalog(after, path);
    const sources = catalogSources(repo);
    const old = analyzeCatalogs(sources);
    sources.set(path, after);
    const next = analyzeCatalogs(sources);
    const ownIssues = next.diagnostics.filter(item => item.sources[0] === path);
    if (ownIssues.length) throw new ConcordError(ownIssues[0]!.code, ownIssues.map(item => item.message).join('; '));
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
