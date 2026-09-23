// @concord-file
// @concord-implements docs/feature/documentation-quality/use-case/inspect-writing.md
// @concord-implements docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Nodes } from 'mdast';
import { Predicate } from 'effect';
import { ConcordError, inRepositorySnapshot, type Repository } from './shared.js';
import { canonicalPath } from './storage.js';
import { readWritingPolicy, type BannedTerm, type WritingPolicy } from './writing-policy.js';
import { analyzeCatalogs, catalogSources, effectiveConcepts, spellingKey, spellingPositions } from './concepts.js';
import { svgTexts } from './writing-text.js';
import { applies, discovered, scopeOf, snapshotDigest, under } from './writing-scopes.js';

export interface WritingFinding { file: string; line: number; rule: string; message: string; context: string; source?: { path: string; line?: number; entry?: number; column?: string; ref?: string }; sources?: readonly { path: string; line?: number; entry?: number; column?: string; ref?: string }[] }
interface Prose { line: number; text: string; readable: string; paragraph: boolean }
interface PolicyOwner { path: string; scope: string; policy: WritingPolicy }
interface Ban { term: string; use: string; why: string; source: NonNullable<WritingFinding['source']>; roots?: readonly string[]; exempt?: readonly string[]; allowIn?: readonly string[]; ownerScope: string; conceptRef?: string }

function authoredSource(file: string, source: string): string {
  let frontmatter = false, generated = false, jsx = false;
  let fence: { marker: string; length: number } | undefined;
  return source.split('\n').map((raw, index) => {
    const line = raw.trim();
    if (index === 0 && line === '---') { frontmatter = true; return ''; }
    if (frontmatter) { if (line === '---' || line === '...') frontmatter = false; return ''; }
    const match = /^(`{3,}|~{3,})/u.exec(line);
    if (fence) { if (match && match[1]![0] === fence.marker && match[1]!.length >= fence.length && line.slice(match[1]!.length).trim() === '') fence = undefined; return raw; }
    if (match) { fence = { marker: match[1]![0]!, length: match[1]!.length }; return raw; }
    if (line.includes('GENERATED:BEGIN')) { generated = true; return ''; }
    if (generated) { if (line.includes('GENERATED:END')) generated = false; return ''; }
    if (/\.mdx$/iu.test(file)) {
      if (jsx) { if (line.endsWith('>')) jsx = false; return ''; }
      if (/^<\/?[A-Za-z]/u.test(line)) { jsx = !line.endsWith('>'); return ''; }
      if (/^(?:import |export |\{\/\*)/u.test(line)) return '';
    }
    return raw;
  }).join('\n');
}
function textOf(node: Nodes, inlineCode: boolean): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'inlineCode') return inlineCode ? node.value : ' ';
  if (node.type === 'image' || node.type === 'imageReference') return inlineCode ? '' : node.alt ?? '';
  if (node.type === 'break') return '\n';
  if ('children' in node) return node.children.map(child => textOf(child, inlineCode)).join('');
  return '';
}
function prose(file: string, source: string): Prose[] {
  const result: Prose[] = [];
  const visit = (node: Nodes): void => {
    if (node.type === 'paragraph' || node.type === 'heading') {
      const text = textOf(node, false);
      result.push({ line: node.position?.start.line ?? 1, text, readable: textOf(node, true), paragraph: node.type === 'paragraph' && !/^\s*\|/u.test(text) });
    } else if ('children' in node) node.children.forEach(visit);
  };
  visit(fromMarkdown(authoredSource(file, source)));
  return result;
}
const length = (text: string): number => [...text.replace(/\s/gu, '')].length;
const rootsOf = (owner: PolicyOwner): readonly string[] => owner.policy.roots ?? [owner.scope];
function applicablePolicy(file: string, policies: readonly PolicyOwner[]): PolicyOwner[] {
  return policies.filter(owner => applies(file, owner.scope)).sort((a, b) => a.scope.length - b.scope.length || a.path.localeCompare(b.path));
}
function inherited<T extends 'sentenceLength' | 'paragraphLength' | 'unusedConcepts' | 'svgTerms' | 'svgStyle'>(owners: readonly PolicyOwner[], key: T): WritingPolicy[T] {
  let value: WritingPolicy[T] = undefined;
  for (const owner of owners) if (owner.policy[key] !== undefined) value = owner.policy[key];
  return value;
}
const sourceLine = (text: string, offset: number): number => text.slice(0, offset).split('\n').length - 1;
const contextLine = (text: string, offset: number): string => text.split('\n')[sourceLine(text, offset)]?.trim().slice(0, 240) ?? '';
function bansFor(file: string, owners: readonly PolicyOwner[], concepts: ReturnType<typeof effectiveConcepts>): Ban[] {
  const bans: Ban[] = owners.flatMap(owner => owner.policy.bannedTerms.map((ban: BannedTerm, index) => ({ ...ban, source: { path: owner.path, entry: index + 1 }, ownerScope: owner.scope })));
  for (const item of concepts) for (const [language, names] of Object.entries(item.concept.names)) for (const term of names.deprecated ?? []) bans.push({ term, use: names.preferred, why: `${item.reference} (${language})`, source: { path: item.path, ref: item.reference, column: language }, ownerScope: item.scope, conceptRef: item.reference });
  return bans.filter(ban => (!ban.roots || ban.roots.some(root => under(file, root))) && !ban.exempt?.some(root => under(file, root)));
}
function checkTerms(file: string, line: number, value: string, bans: readonly Ban[], concepts: ReturnType<typeof effectiveConcepts>, findings: WritingFinding[]): void {
  const active = new Map<string, { reference: string; source: NonNullable<WritingFinding['source']> }[]>();
  for (const item of concepts) for (const [language, names] of Object.entries(item.concept.names)) for (const spelling of [names.preferred, ...(names.aliases ?? [])]) {
    const key = spellingKey(spelling);
    const owners = active.get(key) ?? [];
    if (!owners.some(owner => owner.reference === item.reference)) owners.push({ reference: item.reference, source: { path: item.path, ref: item.reference, column: language } });
    active.set(key, owners);
  }
  const occurrences = new Map<string, { term: string; offset: number; bans: Ban[]; active: { reference: string; source: NonNullable<WritingFinding['source']> }[] }>();
  for (const ban of bans) for (const offset of spellingPositions(value, ban.term, ban.allowIn)) {
    const key = `${offset}:${spellingKey(ban.term)}`;
    const found = occurrences.get(key) ?? { term: ban.term, offset, bans: [], active: active.get(spellingKey(ban.term)) ?? [] };
    found.bans.push(ban); occurrences.set(key, found);
  }
  for (const [term, owners] of active) if (owners.length > 1) for (const offset of spellingPositions(value, term)) {
    const key = `${offset}:${term}`;
    if (!occurrences.has(key)) occurrences.set(key, { term, offset, bans: [], active: owners });
  }
  for (const item of occurrences.values()) {
    const normalizedOutputs = new Set(item.bans.map(ban => spellingKey(ban.use)));
    const differentConcept = item.bans.some(ban => item.active.some(owner => owner.reference !== ban.conceptRef));
    const conflict = normalizedOutputs.size > 1 || differentConcept || new Set(item.active.map(owner => owner.reference)).size > 1;
    const sources = [...item.bans.map(ban => ban.source), ...item.active.map(owner => owner.source)].filter((source, index, all) => all.findIndex(other => JSON.stringify(other) === JSON.stringify(source)) === index);
    const at = line + sourceLine(value, item.offset);
    if (conflict) findings.push({ file, line: at, rule: 'writingConflict', message: `Conflicting terminology for ${item.term}`, context: contextLine(value, item.offset), source: sources[0], sources });
    else if (item.bans.length) findings.push({ file, line: at, rule: 'bannedTerm', message: `${item.term}: use ${item.bans[0]!.use}; ${item.bans.map(ban => ban.why).join('; ')}`, context: contextLine(value, item.offset), source: sources[0], sources });
  }
}

export function checkWriting(repo: Repository, selectedPath?: string) {
  return inRepositorySnapshot(repo, () => {
    const inputs = new Map<string, string>([['concord.config.ts', repo.configSnapshot.source]]);
    const memberships = new Map<string, string[]>();
    const read = (path: string): string => {
      const source = repo.read(path);
      if (source === undefined) throw new ConcordError('WritingInputNotFound', `Missing writing input: ${path}`);
      inputs.set(path, source);
      return source;
    };
    const policyPaths = discovered(repo, 'policy');
    const catalogPaths = discovered(repo, 'catalog');
    const policySources = new Map(policyPaths.map(path => [path, read(path)]));
    const sourceCatalogs = catalogSources(repo);
    for (const [path, source] of sourceCatalogs) inputs.set(path, source);
    const catalogs = analyzeCatalogs(sourceCatalogs);
    if (catalogs.diagnostics.length) throw new ConcordError(catalogs.diagnostics[0]!.code, catalogs.diagnostics.map(item => item.message).join('; '), catalogs.diagnostics);
    let mode: 'project' | 'managed' | 'standalone' = 'project';
    let selection: readonly string[];
    let activePolicies: PolicyOwner[] = [];
    const external = selectedPath !== undefined && !policyPaths.includes(selectedPath) && !(selectedPath.endsWith('/concord-writing.json') && selectedPath.startsWith('docs/') && !selectedPath.includes('/_template/'));
    if (external) {
      canonicalPath(selectedPath); repo.absolute(selectedPath);
      const source = repo.read(selectedPath);
      if (source === undefined) throw new ConcordError('WritingPolicyNotFound', `Missing writing policy: ${selectedPath}`);
      inputs.set(selectedPath, source);
      const profile = readWritingPolicy(source, selectedPath, false);
      mode = 'standalone'; selection = profile.roots ?? ['docs'];
      activePolicies = [{ path: selectedPath, scope: 'docs', policy: profile }];
    } else {
      for (const path of policyPaths) {
        const source = policySources.get(path)!;
        let policy: WritingPolicy;
        try { policy = readWritingPolicy(source, path); }
        catch (cause) {
          let oldFormat = false;
          try { const value: unknown = JSON.parse(source); oldFormat = Predicate.isObject(value) && value.format === 'concord.writing/v1'; } catch { /* malformed source keeps its named validation failure */ }
          if (oldFormat) throw new ConcordError('WritingMigrationRequired', `Migrate ${path} from writing/v1 using writing.show, concepts.set, then writing.set`);
          throw cause;
        }
        activePolicies.push({ path, scope: scopeOf(path, 'policy'), policy });
      }
      if (activePolicies.length === 0 && catalogPaths.length === 0) throw new ConcordError('WritingPolicyNotFound', 'No writing policy or concept catalog was found');
      if (selectedPath === undefined) selection = [...activePolicies.flatMap(rootsOf), ...catalogPaths.filter(path => !policyPaths.includes(path.replace(/concepts\.json$/u, 'concord-writing.json'))).map(path => scopeOf(path, 'catalog'))];
      else {
      canonicalPath(selectedPath); repo.absolute(selectedPath);
      const managed = activePolicies.find(owner => owner.path === selectedPath);
      if (managed) { mode = 'managed'; selection = rootsOf(managed); }
      else throw new ConcordError('WritingPolicyNotFound', `Missing writing policy: ${selectedPath}`);
      }
    }
    const selectedRoots = [...new Set(selection)].sort();
    const files = new Set<string>();
    for (const root of selectedRoots) {
      const members = repo.files(root).filter(path => /\.(?:md|mdx|svg)$/iu.test(path)).sort();
      memberships.set(root, members);
      if (!members.length) throw new ConcordError('WritingInputNotFound', `No Markdown or SVG files in writing root: ${root}`);
      members.forEach(file => files.add(file));
    }
    const documents = new Map<string, Prose[]>();
    const contents = new Map<string, string>();
    for (const file of [...files].sort()) {
      const source = read(file);
      contents.set(file, source);
      if (/\.mdx?$/iu.test(file)) documents.set(file, prose(file, source));
    }
    for (const owner of activePolicies) if (owner.policy.svgStyle && [...files].some(file => applies(file, owner.scope))) read(owner.policy.svgStyle);
    const findings: WritingFinding[] = [];
    const used = new Set<string>(), eligible = new Set<string>();
    const localScopes = [...new Set([...activePolicies.filter(owner => owner.path.startsWith('docs/')).map(owner => owner.scope), ...catalogPaths.map(path => path.slice(0, path.lastIndexOf('/')))].filter(scope => scope !== 'docs'))];
    for (const [file, blocks] of documents) {
      const owners = applicablePolicy(file, activePolicies);
      const concepts = effectiveConcepts(file, catalogs.catalogs);
      const bans = bansFor(file, owners, concepts);
      for (const item of concepts) if (inherited(owners, 'unusedConcepts') === true) eligible.add(item.reference);
      for (const block of blocks) {
        checkTerms(file, block.line, block.text, bans, concepts, findings);
        for (const item of concepts) if (Object.values(item.concept.names).some(names => [names.preferred, ...(names.aliases ?? [])].some(spelling => spellingPositions(block.readable, spelling).length))) used.add(item.reference);
        if (!block.paragraph) continue;
        const paragraphLength = inherited(owners, 'paragraphLength');
        if (paragraphLength != null && length(block.readable) > paragraphLength) findings.push({ file, line: block.line, rule: 'paragraphLength', message: `Paragraph has ${length(block.readable)} characters; maximum ${paragraphLength}`, context: block.readable.trim().slice(0, 240) });
        const sentenceLength = inherited(owners, 'sentenceLength');
        for (const sentence of block.readable.split(/(?<=[。！？!?])|(?<=\.)\s+(?=[A-Z])/u)) if (sentenceLength != null && length(sentence) > sentenceLength) findings.push({ file, line: block.line, rule: 'sentenceLength', message: `Sentence has ${length(sentence)} characters; maximum ${sentenceLength}`, context: sentence.trim().slice(0, 240) });
      }
    }
    for (const item of catalogs.catalogs.flatMap(record => record.catalog.concepts.map(concept => ({ reference: `${record.path}#${concept.id}`, record, concept })))) {
      if (eligible.has(item.reference) && !used.has(item.reference)) findings.push({ file: item.record.path, line: 1, rule: 'unusedConcept', message: `No selected prose uses ${item.reference}`, context: item.concept.definition.slice(0, 240), source: { path: item.record.path, ref: item.reference } });
    }
    for (const [file, content] of contents) if (/\.svg$/iu.test(file)) {
      const owners = applicablePolicy(file, activePolicies);
      const concepts = effectiveConcepts(file, catalogs.catalogs);
      const bans = bansFor(file, owners, concepts);
      const localScope = localScopes.filter(scope => under(file, scope)).sort((a, b) => b.length - a.length)[0];
      const corpus = [...documents].filter(([path]) => localScope ? under(path, localScope) : selectedRoots.some(root => under(path, root))).flatMap(([, blocks]) => blocks.map(block => block.readable)).join('\n');
      const vocabulary = `${corpus}\n${concepts.flatMap(item => Object.values(item.concept.names).flatMap(names => [names.preferred, ...(names.aliases ?? [])])).join('\n')}`;
      for (const node of svgTexts(content)) {
        checkTerms(file, node.line, node.text, bans, concepts, findings);
        if (inherited(owners, 'svgTerms') === true && node.classes.includes('label')) for (const term of node.text.match(/[㐀-䶿一-鿿]+/gu) ?? []) if (!vocabulary.includes(term)) findings.push({ file, line: node.line, rule: 'svgTerm', message: `SVG label has no prose source: ${term}`, context: node.text.slice(0, 240) });
      }
      const stylePath = inherited(owners, 'svgStyle');
      if (stylePath) {
        const style = inputs.get(stylePath) ?? read(stylePath);
        const present = /<style\b[^>]*>([\s\S]*?)<\/style>/iu.exec(content)?.[1]?.trim();
        if (present !== style.trim()) findings.push({ file, line: 1, rule: 'svgStyle', message: `SVG style must match ${stylePath}`, context: present?.slice(0, 240) ?? '(no style)', source: { path: stylePath } });
      }
    }
    for (const [path, before] of inputs) if (repo.read(path) !== before) throw new ConcordError('WritingInputsChanged', `${path} changed during writing checks`);
    for (const [root, before] of memberships) {
      const after = repo.files(root).filter(path => /\.(?:md|mdx|svg)$/iu.test(path)).sort();
      if (JSON.stringify(after) !== JSON.stringify(before)) throw new ConcordError('WritingInputsChanged', `${root} membership changed during writing checks`);
    }
    if (JSON.stringify(discovered(repo, 'policy')) !== JSON.stringify(policyPaths) || JSON.stringify(discovered(repo, 'catalog')) !== JSON.stringify(catalogPaths)) throw new ConcordError('WritingInputsChanged', 'Writing owner membership changed during checks');
    findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
    return { operation: 'docs-check', ok: findings.length === 0, policy: selectedPath ?? 'project', mode, selectedRoots, files: files.size, findings, inputDigest: snapshotDigest([...inputs, ['@writing-policy-membership', JSON.stringify(policyPaths)], ['@concept-catalog-membership', JSON.stringify(catalogPaths)]], [...memberships]) };
  });
}
