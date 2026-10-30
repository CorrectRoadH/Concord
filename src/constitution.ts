import { posix } from 'node:path';
import type { Heading, Nodes, Paragraph, PhrasingContent } from 'mdast';
import { Predicate } from 'effect';
import { parseDocument, stringify } from 'yaml';
import { ConcordError, ProjectSchema, Text, decode, digest, type Change, type Finding, type MutationReceipt, type ProjectConfig, type Repository } from './shared.js';
import { renderTypeScriptConfig } from './config.js';
import { ConstitutionSchema, type ConstitutionMeta } from './constitution-schema.js';
import { fromMarkdown, mdxProse } from './markdown-parser.js';
import { markdownAnchor, markdownBody } from './steps.js';
import { documentMarkdown, documentMarkdownProjection } from './document-projection.js';
import { constitutionDecisionChange } from './memory-write.js';
import { loadDocuments } from './documents.js';

export { ConstitutionSchema } from './constitution-schema.js';
export type { ConstitutionMeta } from './constitution-schema.js';

export const CONSTITUTION_PATH = 'docs/constitution.md';
export interface ConstitutionClause { readonly id: string; readonly title: string; readonly paragraphs: readonly string[] }
export interface ConstitutionRecord { readonly path: typeof CONSTITUTION_PATH; readonly source: string; readonly metadata: ConstitutionMeta; readonly body: string; readonly digest: string; readonly clauses: readonly ConstitutionClause[] }
/** One inline link occurrence; `paragraph` is null when the link targets a clause or the general section. */
export interface ConstitutionReference { readonly path: string; readonly line: number; readonly clause: string; readonly paragraph: string | null }

const CLAUSE_ID = /^c-(?!000)\d{3}$/u;
const SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

// @concord-begin
// @concord-implements docs/feature/project-onboarding/use-case/evolve-constitution.md#read-clauses
function plain(nodes: readonly PhrasingContent[]): string {
  return nodes.map(node => node.type === 'text' || node.type === 'inlineCode' ? node.value : 'children' in node ? plain(node.children) : '').join('');
}

/** A trailing ` {#id}` in the last text node; code, HTML and comments never produce one. */
export function trailingId(source: string, node: Heading | Paragraph): { readonly id: string; readonly start: number } | undefined {
  const last = node.children.at(-1);
  if (last?.type !== 'text' || last.position?.start.offset === undefined || last.position.end.offset === undefined) return undefined;
  const raw = source.slice(last.position.start.offset, last.position.end.offset);
  const match = /[ \t]+\{#([^{}\s]+)\}$/u.exec(raw);
  return match === null ? undefined : { id: match[1]!, start: last.position.end.offset - match[0].length };
}

const invalid = (line: number | undefined, message: string): never => { throw new ConcordError('ConstitutionClauseInvalid', `docs/constitution.md:${line ?? 1}: ${message}`, { path: CONSTITUTION_PATH, line }); };

/** Clauses are H2 headings with `{#c-NNN}`; paragraphs are root ordered items below them with `{#c-NNN-name}`. */
export function constitutionClauses(source: string): ConstitutionClause[] {
  const masked = markdownBody(source);
  const clauses: { id: string; title: string; paragraphs: string[] }[] = [];
  const declared = new Map<string, number>(), slugs = new Set<string>();
  const declare = (id: string, line: number | undefined) => {
    if (declared.has(id)) invalid(line, `duplicate ID ${id}`);
    declared.set(id, line ?? 1);
  };
  let current: { id: string; title: string; paragraphs: string[] } | undefined;
  for (const node of documentMarkdown(CONSTITUTION_PATH, source).children) {
    const line = node.position?.start.line;
    if (node.type === 'heading') {
      if (node.depth <= 2) current = undefined;
      const marker = trailingId(masked, node);
      const text = plain(node.children).replace(/\s+\{#[^{}\s]+\}\s*$/u, '').trim();
      if (marker === undefined) {
        const raw = masked.slice(node.position!.start.offset, node.position!.end.offset);
        const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/u.exec(raw)?.[1];
        const slug = heading === undefined ? undefined : markdownAnchor(`## ${heading}`);
        if (slug !== undefined) { slugs.add(slug); slugs.add(slug.replace(/-+/gu, '-').replace(/^-+|-+$/gu, '')); }
      } else declare(marker.id, line);
      if (node.depth !== 2) continue;
      const label = /^C-(\d+)(?=\s|$)/u.exec(text);
      if (marker?.id === 'general') { current = { id: 'general', title: text, paragraphs: [] }; clauses.push(current); continue; }
      if (label === null && (marker === undefined || !/^c-\d+$/u.test(marker.id))) continue;
      if (marker === undefined) invalid(line, `clause heading "${text}" requires a trailing {#c-NNN}`);
      if (!CLAUSE_ID.test(marker!.id)) invalid(line, `clause ID ${marker!.id} must be c- followed by three digits from 001 to 999`);
      if (label === null || `c-${label[1]}` !== marker!.id) invalid(line, `clause label must be ${marker!.id.toUpperCase()} to match {#${marker!.id}}`);
      const title = text.slice(label![0].length).trim();
      if (title.length === 0) invalid(line, `clause ${marker!.id} requires a title`);
      current = { id: marker!.id, title, paragraphs: [] };
      clauses.push(current);
    } else if (node.type === 'list' && node.ordered === true && current !== undefined) {
      for (const item of node.children) {
        const first = item.children[0];
        const marker = first?.type === 'paragraph' ? trailingId(masked, first) : undefined;
        const itemLine = item.position?.start.line;
        if (marker === undefined) invalid(itemLine, `paragraph of ${current.id} requires a trailing {#${current.id}-<name>} on its first paragraph`);
        const prefix = `${current.id}-`;
        if (!marker!.id.startsWith(prefix) || !SEGMENT.test(marker!.id.slice(prefix.length))) invalid(itemLine, `paragraph ID ${marker!.id} must be ${prefix} followed by lowercase letters, digits and single hyphens`);
        declare(marker!.id, itemLine);
        current.paragraphs.push(marker!.id);
      }
    }
  }
  for (const [id, line] of declared) if (slugs.has(id)) invalid(line, `ID ${id} collides with a heading slug`);
  return clauses;
}

export function clauseIndex(clauses: readonly ConstitutionClause[]): ReadonlyMap<string, { readonly clause: string; readonly paragraph: string | null }> {
  const index = new Map<string, { clause: string; paragraph: string | null }>();
  for (const clause of clauses) {
    index.set(clause.id, { clause: clause.id, paragraph: null });
    for (const paragraph of clause.paragraphs) index.set(paragraph, { clause: clause.id, paragraph });
  }
  return index;
}

function frontmatter(source: string): { readonly value: Record<string, unknown>; readonly body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/u.exec(source);
  if (match === null) throw new ConcordError('InvalidConstitution', 'docs/constitution.md requires strict YAML frontmatter');
  const yaml = parseDocument(match[1]!, { uniqueKeys: true, merge: false });
  if (yaml.errors.length > 0) throw new ConcordError('InvalidConstitution', yaml.errors.map((error) => error.message).join('; '));
  const value: unknown = yaml.toJS({ maxAliasCount: 0 });
  if (!Predicate.isObject(value)) throw new ConcordError('InvalidConstitution', 'Constitution frontmatter must be an object');
  return { value: value as Record<string, unknown>, body: match[2]!.replace(/^\r?\n/u, '') };
}

export function parseConstitution(source: string): ConstitutionRecord {
  const { value, body } = frontmatter(source);
  const metadata = decode(ConstitutionSchema, value, CONSTITUTION_PATH);
  const clauses = constitutionClauses(source);
  if (metadata.status === 'active' && !clauses.some(clause => clause.id !== 'general')) throw new ConcordError('InvalidConstitution', 'An active constitution requires at least one clause with a {#c-NNN} ID');
  return { path: CONSTITUTION_PATH, source, metadata, body, digest: digest(source), clauses };
}

function render(metadata: ConstitutionMeta, body: string): string {
  const valid = decode(ConstitutionSchema, metadata, 'constitution metadata');
  if (body.trim().length === 0) throw new ConcordError('InvalidConstitution', 'Constitution body must be non-empty');
  const source = `---\n${stringify(valid, { lineWidth: 0 }).trimEnd()}\n---\n\n${body.endsWith('\n') ? body : `${body}\n`}`;
  parseConstitution(source);
  return source;
}
// @concord-end

type LinkTarget = { readonly kind: 'invalid'; readonly message: string } | { readonly kind: 'whole' } | { readonly kind: 'fragment'; readonly id: string };
type RelativeLink = { readonly kind: 'relative'; readonly path: string; readonly fragment?: string; readonly query: boolean } | { readonly kind: 'invalid'; readonly message: string };

// @concord-begin
// @concord-implements docs/feature/project-onboarding/use-case/evolve-constitution.md#link-clause
/** Only scheme-less, non-absolute URLs that normalize to the constitution are constitution links. */
export function relativeMarkdownLink(from: string, url: string): RelativeLink | undefined {
  if (/^[a-z][a-z0-9+.-]*:/iu.test(url) || url.startsWith('/')) return undefined;
  const hash = url.indexOf('#');
  const location = hash < 0 ? url : url.slice(0, hash);
  const fragment = hash < 0 ? undefined : url.slice(hash + 1);
  const query = location.indexOf('?');
  const rawPath = query < 0 ? location : location.slice(0, query);
  let decoded: string;
  try { decoded = decodeURIComponent(rawPath); }
  catch { return { kind: 'invalid', message: `Link path ${rawPath} has invalid percent-encoding` }; }
  const target = decoded === '' ? from : posix.normalize(posix.join(posix.dirname(from), decoded));
  return { kind: 'relative', path: target, fragment, query: query >= 0 };
}

export function relativeMarkdownLinkTarget(from: string, url: string, owner: string): LinkTarget | undefined {
  const target = relativeMarkdownLink(from, url);
  if (target === undefined || target.kind === 'invalid') return target;
  if (target.path !== owner) return undefined;
  if (target.query) return { kind: 'invalid', message: `${owner} links must not contain a query` };
  if (target.fragment === undefined || target.fragment === '') return { kind: 'whole' };
  try { return { kind: 'fragment', id: decodeURIComponent(target.fragment) }; }
  catch { return { kind: 'invalid', message: `Link fragment ${target.fragment} has invalid percent-encoding` }; }
}

export function constitutionLinkTarget(from: string, url: string): LinkTarget | undefined {
  return relativeMarkdownLinkTarget(from, url, CONSTITUTION_PATH);
}

/** Inline link nodes only: images, reference links, HTML and code never contribute. */
export function inlineLinks(source: string, path?: string): { readonly url: string; readonly line: number }[] {
  if (path !== undefined) return [...documentMarkdownProjection(path, source).links];
  return markdownLinks(source);
}

/** Reference occurrences use the occurrence's line, rather than the definition's. */
export function markdownLinks(source: string, options: { readonly references?: boolean; readonly mdx?: boolean } = {}): { readonly url: string; readonly line: number }[] {
  const links: { url: string; line: number }[] = [];
  const body = markdownBody(source);
  const tree = fromMarkdown(options.mdx ? mdxProse(body) : body);
  const definitions = new Map<string, string>();
  const index = (node: Nodes): void => {
    if (node.type === 'definition' && !definitions.has(node.identifier)) definitions.set(node.identifier, node.url);
    if ('children' in node) node.children.forEach(index);
  };
  if (options.references) index(tree);
  const visit = (node: Nodes): void => {
    if (node.type === 'link') links.push({ url: node.url, line: node.position?.start.line ?? 1 });
    if (options.references && node.type === 'linkReference') {
      const url = definitions.get(node.identifier);
      if (url !== undefined) links.push({ url, line: node.position?.start.line ?? 1 });
    }
    if ('children' in node) node.children.forEach(visit);
  };
  visit(tree);
  return links;
}

export interface ConstitutionLinkScan {
  readonly references: readonly (ConstitutionReference & { readonly target: string })[];
  readonly broken: readonly { readonly path: string; readonly line: number; readonly id: string }[];
  readonly findings: readonly Finding[];
  readonly complete: boolean;
}

const inScope = (path: string) => path.endsWith('.md') && path !== CONSTITUTION_PATH && !path.startsWith('docs/_template/');

/** Every inline link from authored docs Markdown is a reference occurrence; reverse views derive from this scan. */
export function scanConstitutionLinks(repo: Repository, index: ReadonlyMap<string, { readonly clause: string; readonly paragraph: string | null }>, read: (path: string) => string | undefined = path => repo.read(path)): ConstitutionLinkScan {
  const references: (ConstitutionReference & { target: string })[] = [], broken: { path: string; line: number; id: string }[] = [], findings: Finding[] = [];
  let complete = true;
  for (const path of repo.files('docs').filter(inScope).sort()) {
    let source: string | undefined;
    try { source = read(path); }
    catch (cause) { complete = false; findings.push({ code: cause instanceof ConcordError ? cause.code : 'SourceChanged', path, message: cause instanceof Error ? cause.message : String(cause) }); continue; }
    if (source === undefined) { complete = false; findings.push({ code: 'SourceChanged', path, message: 'File disappeared while constitution references were read' }); continue; }
    // Any constitution link spells the path, percent-encodes it, or uses a character reference.
    if (!/constitution|[%&]/iu.test(source)) continue;
    for (const link of inlineLinks(source, path)) {
      const target = constitutionLinkTarget(path, link.url);
      if (target === undefined || target.kind === 'whole') continue;
      if (target.kind === 'invalid') { complete = false; findings.push({ code: 'ConstitutionLinkInvalid', path, line: link.line, message: target.message }); continue; }
      const resolved = index.get(target.id);
      if (resolved === undefined) {
        broken.push({ path, line: link.line, id: target.id });
        findings.push({ code: 'AnchorNotFound', path, line: link.line, message: `Constitution clause ${target.id} does not exist` });
        continue;
      }
      references.push({ path, line: link.line, clause: resolved.clause, paragraph: resolved.paragraph, target: target.id });
    }
  }
  return { references, broken, findings, complete };
}

export interface ConstitutionInspection { readonly record?: ConstitutionRecord; readonly references: ConstitutionLinkScan['references']; readonly findings: readonly Finding[]; readonly complete: boolean }

/** Structure, current adoption state and all in-scope references, without throwing for diagnosable states. */
export function inspectConstitution(repo: Repository, read?: (path: string) => string | undefined): ConstitutionInspection {
  if (repo.config.constitution === undefined) return { references: [], findings: [], complete: true };
  let record: ConstitutionRecord;
  try { record = showConstitution(repo); }
  catch (cause) {
    const details = cause instanceof ConcordError && Predicate.isObject(cause.details) && typeof cause.details.line === 'number' ? { line: cause.details.line } : {};
    return { references: [], findings: [{ code: cause instanceof ConcordError ? cause.code : 'InvalidConstitution', path: CONSTITUTION_PATH, ...details, message: cause instanceof Error ? cause.message : String(cause) }], complete: true };
  }
  const scan = scanConstitutionLinks(repo, clauseIndex(record.clauses), read);
  const draft: Finding[] = record.metadata.status === 'draft' ? [{ code: 'ConstitutionDraft', path: record.path, message: 'The project constitution is structurally valid but still draft; adopt real principles explicitly.' }] : [];
  return { record, references: scan.references, findings: [...draft, ...scan.findings], complete: scan.complete };
}
// @concord-end

// @concord-code
// @concord-implements docs/feature/project-onboarding/use-case/evolve-constitution.md#read-clauses
export function showConstitution(repo: Repository): ConstitutionRecord {
  const source = repo.read(CONSTITUTION_PATH);
  if (source === undefined) throw new ConcordError('ConstitutionMissing', 'docs/constitution.md is missing; run concord constitution initialize for an existing project');
  return parseConstitution(source);
}

// @concord-code
// @concord-implements docs/feature/project-onboarding/use-case/evolve-constitution.md#show-references
export function constitutionShow(repo: Repository) {
  const constitution = showConstitution(repo);
  const scan = scanConstitutionLinks(repo, clauseIndex(constitution.clauses));
  const references = scan.references.map(({ path, line, clause, paragraph }) => ({ path, line, clause, paragraph }));
  return { operation: 'constitution-show', constitution, references, complete: scan.complete };
}

// @concord-code
// @concord-implements docs/feature/project-onboarding/use-case/evolve-constitution.md#check-links
export function checkConstitution(repo: Repository): Finding[] {
  return [...inspectConstitution(repo).findings];
}

// @concord-begin
// @concord-implements docs/feature/project-onboarding/use-case/evolve-constitution.md#amend
function required(value: string, field: string): string {
  if (value.trim() !== value || value.length === 0) throw new ConcordError('InvalidInput', `${field} must be non-empty without surrounding whitespace`);
  return decode(Text, value, field);
}

/** Validate every in-scope reference and the candidate's own links against the candidate IDs. */
function guardReferences(repo: Repository, current: ConstitutionRecord, candidateSource: string): void {
  const candidate = clauseIndex(parseConstitution(candidateSource).clauses), previous = clauseIndex(current.clauses);
  const scan = scanConstitutionLinks(repo, candidate);
  const invalidLink = scan.findings.find(finding => finding.code === 'ConstitutionLinkInvalid');
  if (invalidLink !== undefined) throw new ConcordError('ConstitutionLinkInvalid', `${invalidLink.path}:${invalidLink.line}: ${invalidLink.message}`, [invalidLink]);
  if (!scan.complete) throw new ConcordError('SourceChanged', 'Constitution references could not be read completely; retry after the sources settle', scan.findings);
  const internal: { path: string; line: number; id: string }[] = [];
  for (const link of inlineLinks(candidateSource, CONSTITUTION_PATH)) {
    const target = constitutionLinkTarget(CONSTITUTION_PATH, link.url);
    if (target?.kind === 'invalid') throw new ConcordError('ConstitutionLinkInvalid', `${CONSTITUTION_PATH}:${link.line}: ${target.message}`);
    if (target?.kind === 'fragment' && !candidate.has(target.id)) internal.push({ path: CONSTITUTION_PATH, line: link.line, id: target.id });
  }
  const removedIds = new Set([...previous.keys()].filter(id => !candidate.has(id)));
  const promotions = removedIds.size === 0 ? [] : loadDocuments(repo, ['memory']).flatMap(record => record.metadata.kind !== 'memory' || record.metadata.state !== 'current' ? [] : record.metadata.promotions.flatMap(reference => {
    if (!reference.startsWith(`${CONSTITUTION_PATH}#`)) return [];
    const id = reference.slice(CONSTITUTION_PATH.length + 1);
    if (!removedIds.has(id)) return [];
    const lines = repo.read(record.path)!.split('\n');
    const occurrence = lines.findIndex(line => line.includes(reference));
    return [{ path: record.path, line: occurrence < 0 ? 1 : occurrence + 1, id }];
  }));
  const removed = [...scan.broken, ...internal, ...promotions].filter(item => previous.has(item.id));
  if (removed.length > 0) throw new ConcordError('ConstitutionClauseReferenced', `Removed IDs are still referenced: ${removed.map(item => `${item.path}:${item.line} #${item.id}`).join(', ')}`, removed);
  const missing = internal.find(item => !previous.has(item.id));
  if (missing !== undefined) throw new ConcordError('AnchorNotFound', `${CONSTITUTION_PATH}:${missing.line}: Constitution clause ${missing.id} does not exist`);
}

/** Compare the complete owned clause prose and list items, including continuation blocks. */
function declarationBodies(source: string): Map<string, string> {
  const masked = markdownBody(source), bodies = new Map<string, string>();
  let clause: string | undefined;
  for (const node of documentMarkdown(CONSTITUTION_PATH, source).children) {
    const raw = masked.slice(node.position?.start.offset, node.position?.end.offset).trim();
    if (node.type === 'heading' && node.depth <= 2) {
      clause = node.depth === 2 ? trailingId(masked, node)?.id : undefined;
      if (clause !== undefined) bodies.set(clause, raw);
    } else if (clause !== undefined && node.type === 'list' && node.ordered === true) {
      for (const item of node.children) {
        const first = item.children[0];
        const id = first?.type === 'paragraph' ? trailingId(masked, first)?.id : undefined;
        if (id !== undefined) bodies.set(id, masked.slice(item.position?.start.offset, item.position?.end.offset).trim());
      }
    } else if (clause !== undefined) bodies.set(clause, `${bodies.get(clause)}\n${raw}`);
  }
  return bodies;
}

/** Removed paragraphs promote to their surviving clause; no promotion points at a removed ID. */
export function amendedTargets(before: string, after: string): string[] {
  const previous = declarationBodies(before), current = declarationBodies(after), next = clauseIndex(parseConstitution(after).clauses);
  const changed = new Set([...next.keys()].filter(id => current.get(id) !== previous.get(id)));
  for (const id of previous.keys()) {
    if (next.has(id)) continue;
    const clause = id.startsWith('general-') ? 'general' : /^c-\d{3}/u.exec(id)?.[0];
    if (clause !== undefined && next.has(clause)) changed.add(clause);
  }
  return changed.size === 0 ? [CONSTITUTION_PATH] : [...changed].map(id => `${CONSTITUTION_PATH}#${id}`);
}

export interface ConstitutionReceipt extends MutationReceipt { readonly memory: string }

interface LifecycleInput { readonly body: string; readonly reason: string; readonly impact: string; readonly sources: readonly string[]; readonly expectedDigest: string }

function lifecycle(repo: Repository, operation: 'constitution-adopt' | 'constitution-amend', input: LifecycleInput, dryRun: boolean): ConstitutionReceipt {
  const current = showConstitution(repo);
  if (current.digest !== input.expectedDigest) throw new ConcordError('PreimageChanged', 'docs/constitution.md changed; reload it and retry');
  const adoption = operation === 'constitution-adopt';
  if (adoption && current.metadata.status !== 'draft') throw new ConcordError('ConstitutionAlreadyActive', 'Use constitution amend for an active constitution');
  if (!adoption && current.metadata.status !== 'active') throw new ConcordError('ConstitutionNotActive', 'Adopt the draft constitution before amending it');
  const reason = required(input.reason, 'reason'), impact = required(input.impact, 'impact');
  const sources = input.sources.map(source => required(source, 'source'));
  const after = render({ status: 'active' }, input.body);
  guardReferences(repo, current, after);
  const decision = constitutionDecisionChange(repo.config.memorySources, path => repo.read(path) !== undefined, {
    adoption, reason, impact, sources, at: new Date().toISOString(),
    promotions: adoption ? [CONSTITUTION_PATH] : amendedTargets(current.source, after),
  });
  const receipt = repo.publish(operation, [{ path: current.path, before: current.source, after }, decision], dryRun);
  return { ...receipt, memory: decision.path };
}

export function adoptConstitution(repo: Repository, body: string, reason: string, impact: string, sources: readonly string[], expectedDigest: string, dryRun = false): ConstitutionReceipt {
  return lifecycle(repo, 'constitution-adopt', { body, reason, impact, sources, expectedDigest }, dryRun);
}

export function amendConstitution(repo: Repository, body: string, reason: string, impact: string, sources: readonly string[], expectedDigest: string, dryRun = false): ConstitutionReceipt {
  return lifecycle(repo, 'constitution-amend', { body, reason, impact, sources, expectedDigest }, dryRun);
}

export interface InitialConstitutionOptions {
  readonly body: string;
  readonly active?: boolean;
  readonly reason?: string;
  readonly impact?: string;
  readonly sources?: readonly string[];
  readonly memorySources?: ProjectConfig['memorySources'];
  readonly exists?: (path: string) => boolean;
}

/** Shared constructor for init and the later constitution lifecycle; an active start also records its Decision. */
export function initialConstitution(options: InitialConstitutionOptions): { readonly source: string; readonly decision?: Change } {
  const active = options.active === true;
  if (active && (!options.reason || !options.impact)) throw new ConcordError('InvalidConstitution', 'Adopting the constitution requires a non-empty reason and impact');
  const source = render({ status: active ? 'active' : 'draft' }, options.body);
  if (!active) return { source };
  const decision = constitutionDecisionChange(options.memorySources, options.exists ?? (() => false), {
    adoption: true, reason: required(options.reason!, 'reason'), impact: required(options.impact!, 'impact'),
    sources: (options.sources ?? []).map(value => required(value, 'source')), promotions: [CONSTITUTION_PATH], at: new Date().toISOString(),
  });
  return { source, decision };
}

export function initializeConstitution(repo: Repository, dryRun = false): MutationReceipt {
  if (repo.read(CONSTITUTION_PATH) !== undefined) throw new ConcordError('ConstitutionExists', 'docs/constitution.md already exists');
  const next = decode(ProjectSchema, { ...repo.config, constitution: { path: CONSTITUTION_PATH } }, 'constitution configuration');
  const configAfter = renderTypeScriptConfig(next);
  return repo.publish('constitution-initialize', [
    { path: repo.configSnapshot.path, before: repo.configSnapshot.source, after: configAfter },
    { path: CONSTITUTION_PATH, before: null, after: initialConstitution({ body: '# Project constitution\n\nNo project principles have been adopted. This constitution is a draft.\n' }).source },
  ], dryRun);
}
// @concord-end
