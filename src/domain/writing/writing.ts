import type { WritingFinding, WritingReport } from "../../model/index.js";
import { fromMarkdown } from "../../model/index.js";
import type { Nodes } from "mdast";
import { ConcordError, inRepositorySnapshot, objectDigest, type Repository } from "../../model/index.js";
import { WRITING_PARSER_VERSION, writingBudget, type PolicySource } from "../../model/index.js";
import { LocalRepository } from "../../base/workspace/index.js";
import { canonicalPath } from "../../model/index.js";
import { readWritingPolicy } from "./writing-policy.js";
import type { BannedTerm, WritingPolicy } from "../../model/index.js";
import { analyzeCatalogs, effectiveConcepts, spellingKey, spellingPositions } from "../concepts/index.js";
import { applies, discovered, scopeOf, snapshotDigest, under } from "../../model/index.js";
import { extractSteps } from "../documents/index.js";
import { readWritingFindings, writeWritingFindings } from "../../base/cache/index.js";
// @concord-begin
// @concord-implements docs/feature/documentation-quality/use-case/inspect-writing.md
function withoutStepMarkers(path: string, source: string): string {
  if (!source.includes('{#')) return source;
  const lines = source.split('\n');
  for (const range of extractSteps(path, source).markers) {
    const line = lines[range.line - 1]!;
    lines[range.line - 1] = line.slice(0, range.startColumn) + ' '.repeat(range.endColumn - range.startColumn) + line.slice(range.endColumn);
  }
  return lines.join('\n');
}
interface Prose { line: number; text: string; readable: string; sentences: readonly string[]; paragraph: boolean }
interface PolicyOwner { path: string; scope: string; policy: WritingPolicy }
interface Ban { term: string; use: string; why: string; source: NonNullable<WritingFinding['source']>; roots?: readonly string[]; exempt?: readonly string[]; allowIn?: readonly string[]; ownerScope: string; conceptRef?: string }

function authoredSource(file: string, source: string, positions = false): string {
  let frontmatter = false, generated = false, jsx = false;
  let fence: { marker: string; length: number } | undefined;
  const originalLines = source.split('\n');
  return originalLines.map((raw, index) => {
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
  }).map((line, index) => positions && line === '' ? ' '.repeat(originalLines[index]!.length) : line).join('\n');
}
// Marks where inline code starts so sentence splitting sees the boundary the
// rendered text loses; it never reaches lengths, contexts or term checks.
const CODE_START = '\uE000';
const SENTENCE_BREAK = /(?<=[。！？!?])|(?<=[.!?])\s+(?=[\uE000A-Z0-9"'“‘(\[\p{Script=Han}])/u;
function textOf(node: Nodes, inlineCode: boolean, markCode = false): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'inlineCode') return inlineCode ? `${markCode ? CODE_START : ''}${node.value}` : ' ';
  if (node.type === 'image' || node.type === 'imageReference') return inlineCode ? '' : node.alt ?? '';
  if (node.type === 'break') return '\n';
  if ('children' in node) return node.children.map(child => textOf(child, inlineCode, markCode)).join('');
  return '';
}
function prose(file: string, source: string): { blocks: Prose[]; tree: ReturnType<typeof fromMarkdown>; source: string } {
  const result: Prose[] = [];
  const visit = (node: Nodes): void => {
    if (node.type === 'paragraph' || node.type === 'heading') {
      const text = textOf(node, false);
      const sentences = textOf(node, true, true).split(SENTENCE_BREAK).map(sentence => sentence.replaceAll(CODE_START, ''));
      result.push({ line: node.position?.start.line ?? 1, text, readable: text, sentences: text.split(SENTENCE_BREAK), paragraph: node.type === 'paragraph' && !/^\s*\|/u.test(text) });
    } else if ('children' in node) node.children.forEach(visit);
  };
  const authored = authoredSource(file, source), tree = fromMarkdown(authored);
  visit(tree);
  return { blocks: result, tree, source: authored };
}
// @concord-end
const length = (text: string): number => [...text.replace(/\s/gu, '')].length;
const rootsOf = (owner: PolicyOwner): readonly string[] => owner.policy.roots ?? [owner.scope];
// @concord-begin
// @concord-implements docs/feature/documentation-quality/format.md#conceptsmd
// @concord-implements docs/feature/documentation-quality/format.md#writingmd
function applicablePolicy(file: string, policies: readonly PolicyOwner[]): PolicyOwner[] {
  return policies.filter(owner => applies(file, owner.scope)).sort((a, b) => a.scope.length - b.scope.length || a.path.localeCompare(b.path));
}
function inherited<T extends 'sentenceLength' | 'paragraphLength'>(owners: readonly PolicyOwner[], key: T): WritingPolicy[T] {
  let value: WritingPolicy[T] = undefined;
  for (const owner of owners) if (owner.policy[key] !== undefined) value = owner.policy[key];
  return value;
}
const sourceLine = (text: string, offset: number): number => text.slice(0, offset).split('\n').length - 1;
const contextLine = (text: string, offset: number): string => text.split('\n')[sourceLine(text, offset)]?.trim().slice(0, 240) ?? '';
function bansFor(file: string, owners: readonly PolicyOwner[], concepts: ReturnType<typeof effectiveConcepts>): Ban[] {
  const bans: Ban[] = owners.flatMap(owner => owner.policy.bannedTerms.map((ban: BannedTerm, index) => ({ ...ban, source: { path: owner.path, entry: index + 1 }, ownerScope: owner.scope })));
  for (const item of concepts) for (const term of item.concept.deprecated) bans.push({ term, use: item.concept.term, why: item.reference, source: { path: item.path, ref: item.reference }, ownerScope: item.scope, conceptRef: item.reference });
  return bans.filter(ban => (!ban.roots || ban.roots.some(root => under(file, root))));
}
function activeSpellingsFor(concepts: ReturnType<typeof effectiveConcepts>) {
  const active = new Map<string, { reference: string; source: NonNullable<WritingFinding['source']> }[]>();
  for (const item of concepts) {
    const spelling = item.concept.term;
    const key = spellingKey(spelling);
    const owners = active.get(key) ?? [];
    if (!owners.some(owner => owner.reference === item.reference)) owners.push({ reference: item.reference, source: { path: item.path, ref: item.reference } });
    active.set(key, owners);
  }
  return active;
}
// @concord-end
// @concord-code
// @concord-implements docs/feature/documentation-quality/format.md#conceptsmd
function checkTerms(file: string, line: number, value: string, bans: readonly Ban[], active: ReturnType<typeof activeSpellingsFor>, findings: WritingFinding[]): void {
  const occurrences = new Map<string, { term: string; offset: number; bans: Ban[]; active: { reference: string; source: NonNullable<WritingFinding['source']> }[] }>();
  let candidates = 0;
  for (const ban of bans) for (const offset of spellingPositions(value, ban.term, ban.allowIn)) {
    if (++candidates > 100000) writingBudget(`${file}:${line}: paragraph exceeds 100000 candidate intervals`);
    const key = `${offset}:${spellingKey(ban.term)}`;
    const found = occurrences.get(key) ?? { term: ban.term, offset, bans: [], active: active.get(spellingKey(ban.term)) ?? [] };
    found.bans.push(ban); occurrences.set(key, found);
  }
  for (const [term, owners] of active) if (owners.length > 1) for (const offset of spellingPositions(value, term)) {
    const key = `${offset}:${term}`;
    if (!occurrences.has(key)) occurrences.set(key, { term, offset, bans: [], active: owners });
  }
  if (occurrences.size > 100000) writingBudget(`${file}:${line}: paragraph exceeds 100000 candidate intervals`);
  for (const item of occurrences.values()) {
    const normalizedOutputs = new Set(item.bans.map(ban => spellingKey(ban.use)));
    const differentConcept = item.bans.some(ban => item.active.some(owner => owner.reference !== ban.conceptRef));
    const conflict = normalizedOutputs.size > 1 || differentConcept || new Set(item.active.map(owner => owner.reference)).size > 1;
    const sources = [...item.bans.map(ban => ban.source), ...item.active.map(owner => owner.source)].filter((source, index, all) => all.findIndex(other => JSON.stringify(other) === JSON.stringify(source)) === index);
    const at = line + sourceLine(value, item.offset);
    if (conflict) findings.push({ file, line: at, rule: 'writingConflict', message: `Conflicting terminology for ${item.term}`, context: contextLine(value, item.offset), source: sources[0], sources });
    else if (item.bans.length) findings.push({ file, line: at, rule: 'bannedTerm', message: `${item.term}: use ${item.bans[0]!.use}; ${item.bans.map(ban => ban.why).join('; ')}`, context: contextLine(value, item.offset), source: sources[0], sources });
    if (findings.length > 10000) writingBudget('Writing report exceeds 10000 findings');
  }
}

// @concord-code
// @concord-implements docs/feature/documentation-quality/use-case/inspect-writing.md
export function checkWriting(repo: Repository, selectedPath?: string, persistentCache = repo instanceof LocalRepository): WritingReport {
  return inRepositorySnapshot(repo, () => {
    const inputs = new Map<string, string>([['concord.config.ts', repo.configSnapshot.source]]);
    const memberships = new Map<string, string[]>();
    const read = (path: string): string => {
      const source = repo.read(path);
      if (source === undefined) throw new ConcordError('WritingInputNotFound', `Missing writing input: ${path}`);
      inputs.set(path, source);
      return source;
    };
    const docsMembers = repo.files('docs');
    const policyPaths = discovered(repo, 'policy', docsMembers);
    const catalogPaths = discovered(repo, 'catalog', docsMembers);
    const policySources = new Map(policyPaths.map(path => [path, read(path)]));
    const sourceCatalogs = new Map(catalogPaths.map(path => [path, read(path)]));
    let mode: 'project' | 'managed' = 'project';
    const activePolicies: PolicyOwner[] = policyPaths.map(path => ({ path, scope: scopeOf(path, 'policy'), policy: readWritingPolicy(policySources.get(path)!, path) }));
    let selection: readonly string[] = activePolicies.find(owner => owner.path === 'docs/writing.md')?.policy.roots ?? ['docs'];
    if (selectedPath !== undefined) {
      const managed = activePolicies.find(owner => owner.path === selectedPath);
      if (!managed) throw new ConcordError('WritingPolicyNotFound', `Missing managed writing rules: ${selectedPath}`);
      mode = 'managed'; selection = [managed.scope];
    }
    const selectedRoots = [...new Set(selection)].sort();
    const files = new Set<string>();
    for (const root of selectedRoots) {
      const members = (root === 'docs' ? docsMembers : repo.files(root)).filter(path => /\.(?:md|mdx)$/iu.test(path)).sort();
      memberships.set(root, members);
      if (!members.length && root !== 'docs') throw new ConcordError('WritingInputNotFound', `No Markdown or MDX files in writing root: ${root}`);
      members.forEach(file => files.add(file));
    }
    const documents = new Map<string, string>();
    for (const file of [...files].sort()) {
      const source = read(file);
      if (!policySources.has(file) && /\.mdx?$/iu.test(file)) documents.set(file, source);
    }
    const inputDigest = snapshotDigest([...inputs, ['@writing-parser-version', WRITING_PARSER_VERSION], ['@writing-policy-membership', JSON.stringify(policyPaths)], ['@concept-catalog-membership', JSON.stringify(catalogPaths)]], [...memberships]);
    const cacheDigest = objectDigest({ inputDigest, selectedPath: selectedPath ?? null });
    const cached = persistentCache ? readWritingFindings(repo, cacheDigest) : undefined;
    const findings: WritingFinding[] = cached ?? [];
    if (cached === undefined) {
      // The cache key binds every catalog byte and the parser revision. Reparse
      // changed or uncached sources; exact validated hits need no Markdown parser.
      const catalogs = analyzeCatalogs(sourceCatalogs);
      if (catalogs.diagnostics.length) throw new ConcordError(catalogs.diagnostics[0]!.code, catalogs.diagnostics.map(item => item.message).join('; '), catalogs.diagnostics);
      const used = new Set<string>(), eligible = new Set<string>();
      for (const [file, authored] of documents) {
        const source = withoutStepMarkers(file, authored);
        const parsed = prose(file, source);
        const owners = applicablePolicy(file, activePolicies);
        const concepts = effectiveConcepts(file, catalogs.catalogs);
        const bans = bansFor(file, owners, concepts);
        const active = activeSpellingsFor(concepts);
        for (const item of concepts) eligible.add(item.reference);
        for (const block of parsed.blocks) {
          checkTerms(file, block.line, block.text, bans, active, findings);
          for (const item of concepts) if (!used.has(item.reference) && !sourceCatalogs.has(file) && spellingPositions(block.readable, item.concept.term).length > 0) used.add(item.reference);
          if (!block.paragraph) continue;
          const legacySource = (key: 'paragraphLength' | 'sentenceLength'): PolicySource | undefined => { const owner = [...owners].reverse().find(owner => owner.policy[key] !== undefined); return owner ? { path: owner.path, pointer: `/${key}` } : undefined; };
          const paragraphLength = inherited(owners, 'paragraphLength');
          if (paragraphLength != null && length(block.readable) > paragraphLength) findings.push({ file, line: block.line, rule: 'paragraphLength', message: `Paragraph has ${length(block.readable)} characters; maximum ${paragraphLength}`, context: block.readable.trim().slice(0, 240), source: legacySource('paragraphLength') });
          const sentenceLength = inherited(owners, 'sentenceLength');
          for (const sentence of block.sentences) {
            if (sentenceLength != null && length(sentence) > sentenceLength) findings.push({ file, line: block.line, rule: 'sentenceLength', message: `Sentence has ${length(sentence)} characters; maximum ${sentenceLength}`, context: sentence.trim().slice(0, 240), source: legacySource('sentenceLength') });
            if (findings.length > 10000) writingBudget('Writing report exceeds 10000 findings');
          }
        }
        const original = inputs.get(file)!;
        if (findings.length > 10000) writingBudget('Writing report exceeds 10000 findings');
      }
      for (const item of catalogs.catalogs.flatMap(record => record.catalog.concepts.map(concept => ({ reference: `${record.path}#${concept.id}`, record, concept })))) {
        if (eligible.has(item.reference) && !used.has(item.reference)) findings.push({ file: item.record.path, line: 1, rule: 'unusedConcept', message: `No selected prose uses ${item.reference}`, context: item.concept.definition.slice(0, 240), source: { path: item.record.path, ref: item.reference } });
        if (findings.length > 10000) writingBudget('Writing report exceeds 10000 findings');
      }
    }
    for (const [path, before] of inputs) if (repo.read(path) !== (path === 'concord.config.ts' && before === '' ? undefined : before)) throw new ConcordError('WritingInputsChanged', `${path} changed during writing checks`);
    const currentDocsMembers = repo.files('docs');
    for (const [root, before] of memberships) {
      const after = (root === 'docs' ? currentDocsMembers : repo.files(root)).filter(path => /\.(?:md|mdx)$/iu.test(path)).sort();
      if (JSON.stringify(after) !== JSON.stringify(before)) throw new ConcordError('WritingInputsChanged', `${root} membership changed during writing checks`);
    }
    if (JSON.stringify(discovered(repo, 'policy', currentDocsMembers)) !== JSON.stringify(policyPaths) || JSON.stringify(discovered(repo, 'catalog', currentDocsMembers)) !== JSON.stringify(catalogPaths)) throw new ConcordError('WritingInputsChanged', 'Writing owner membership changed during checks');
    if (findings.length > 10000) writingBudget('Writing report exceeds 10000 findings');
    findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
    if (persistentCache && cached === undefined) writeWritingFindings(repo, cacheDigest, findings);
    return { operation: 'docs-check', ok: findings.length === 0, complete: true, policy: selectedPath ?? 'project', mode, selectedRoots, files: documents.size, findings, inputDigest };
  });
}
