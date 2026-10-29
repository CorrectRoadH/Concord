import { posix } from 'node:path';
import type { Heading, Nodes, Paragraph, PhrasingContent } from 'mdast';
import { Predicate } from 'effect';
import { parseDocument, stringify } from 'yaml';
import { ConcordError, ProjectSchema, Text, decode, digest, type Finding, type MutationReceipt, type Repository } from './shared.js';
import { renderTypeScriptConfig } from './config.js';
import { ConstitutionSchema, type ConstitutionMeta } from './constitution-schema.js';
import { fromMarkdown } from './markdown-parser.js';
import { markdownAnchor, markdownBody } from './steps.js';
import { documentMarkdown, documentProjection } from './document-projection.js';

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
  if (value.format === 'concord.constitution/v1') throw new ConcordError('ConstitutionMigrationRequired', 'docs/constitution.md uses concord.constitution/v1; run concord constitution migrate', { path: CONSTITUTION_PATH });
  const metadata = decode(ConstitutionSchema, value, CONSTITUTION_PATH);
  if ((metadata.status === 'draft') !== (metadata.ratifiedAt === null)) throw new ConcordError('InvalidConstitution', 'draft requires ratifiedAt:null and active requires a ratified date');
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

// @concord-begin
// @concord-implements docs/feature/project-onboarding/use-case/evolve-constitution.md#link-clause
/** Only scheme-less, non-absolute URLs that normalize to the constitution are constitution links. */
export function relativeMarkdownLinkTarget(from: string, url: string, owner: string): LinkTarget | undefined {
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
  if (target !== owner) return undefined;
  if (query >= 0) return { kind: 'invalid', message: `${owner} links must not contain a query` };
  if (fragment === undefined || fragment === '') return { kind: 'whole' };
  try { return { kind: 'fragment', id: decodeURIComponent(fragment) }; }
  catch { return { kind: 'invalid', message: `Link fragment ${fragment} has invalid percent-encoding` }; }
}

export function constitutionLinkTarget(from: string, url: string): LinkTarget | undefined {
  return relativeMarkdownLinkTarget(from, url, CONSTITUTION_PATH);
}

/** Inline link nodes only: images, reference links, HTML and code never contribute. */
export function inlineLinks(source: string, path?: string): { readonly url: string; readonly line: number }[] {
  if (path !== undefined) return [...documentProjection(path, source).links];
  const links: { url: string; line: number }[] = [];
  const visit = (node: Nodes): void => {
    if (node.type === 'link') links.push({ url: node.url, line: node.position?.start.line ?? 1 });
    if ('children' in node) node.children.forEach(visit);
  };
  visit(fromMarkdown(markdownBody(source)));
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

/** Structure, migration state and all in-scope references, without throwing for diagnosable states. */
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
  const removed = [...scan.broken, ...internal].filter(item => previous.has(item.id));
  if (removed.length > 0) throw new ConcordError('ConstitutionClauseReferenced', `Removed IDs are still referenced: ${removed.map(item => `${item.path}:${item.line} #${item.id}`).join(', ')}`, removed);
  const missing = internal.find(item => !previous.has(item.id));
  if (missing !== undefined) throw new ConcordError('AnchorNotFound', `${CONSTITUTION_PATH}:${missing.line}: Constitution clause ${missing.id} does not exist`);
}

export function adoptConstitution(repo: Repository, body: string, reason: string, impact: string, sources: readonly string[], expectedDigest: string, dryRun = false): MutationReceipt {
  const current = showConstitution(repo);
  if (current.digest !== expectedDigest) throw new ConcordError('PreimageChanged', 'docs/constitution.md changed; reload it and retry');
  if (current.metadata.status !== 'draft') throw new ConcordError('ConstitutionAlreadyActive', 'Use constitution amend for an active constitution');
  const date = new Date().toISOString().slice(0, 10);
  const entry = { date, reason: required(reason, 'reason'), sources: sources.map((source) => required(source, 'source')), impact: required(impact, 'impact') };
  const metadata = decode(ConstitutionSchema, { ...current.metadata, status: 'active', ratifiedAt: date, amendedAt: date, amendments: [...current.metadata.amendments, entry] }, 'constitution adoption');
  const after = render(metadata, body);
  guardReferences(repo, current, after);
  return repo.publish('constitution-adopt', [{ path: current.path, before: current.source, after }], dryRun);
}

export function amendConstitution(repo: Repository, body: string, reason: string, impact: string, sources: readonly string[], expectedDigest: string, dryRun = false): MutationReceipt {
  const current = showConstitution(repo);
  if (current.digest !== expectedDigest) throw new ConcordError('PreimageChanged', 'docs/constitution.md changed; reload it and retry');
  if (current.metadata.status !== 'active') throw new ConcordError('ConstitutionNotActive', 'Adopt the draft constitution before amending it');
  const date = new Date().toISOString().slice(0, 10);
  const entry = { date, reason: required(reason, 'reason'), sources: sources.map((source) => required(source, 'source')), impact: required(impact, 'impact') };
  const metadata = decode(ConstitutionSchema, { ...current.metadata, amendedAt: date, amendments: [...current.metadata.amendments, entry] }, 'constitution amendment');
  const after = render(metadata, body);
  guardReferences(repo, current, after);
  return repo.publish('constitution-amend', [{ path: current.path, before: current.source, after }], dryRun);
}

export interface InitialConstitutionOptions {
  readonly body: string;
  readonly active?: boolean;
  readonly reason?: string;
  readonly impact?: string;
  readonly sources?: readonly string[];
  readonly date?: string;
}

/** Shared constructor for init and the later constitution lifecycle. */
export function initialConstitutionSource(options: InitialConstitutionOptions): string {
  const date = options.date ?? new Date().toISOString().slice(0, 10);
  const active = options.active === true;
  if (active && (!options.reason || !options.impact)) throw new ConcordError('InvalidConstitution', 'Adopting the constitution requires a non-empty reason and impact');
  const amendments = active ? [{ date, reason: required(options.reason!, 'reason'), sources: (options.sources ?? []).map((source) => required(source, 'source')), impact: required(options.impact!, 'impact') }] : [];
  const metadata = decode(ConstitutionSchema, {
    format: 'concord.constitution/v2', status: active ? 'active' : 'draft',
    ratifiedAt: active ? date : null, amendedAt: date, amendments,
  }, 'constitution initialization');
  return render(metadata, options.body);
}

export function initializeConstitution(repo: Repository, dryRun = false): MutationReceipt {
  if (repo.read(CONSTITUTION_PATH) !== undefined) throw new ConcordError('ConstitutionExists', 'docs/constitution.md already exists');
  const next = decode(ProjectSchema, { ...repo.config, constitution: { path: CONSTITUTION_PATH } }, 'constitution configuration');
  const configAfter = renderTypeScriptConfig(next);
  return repo.publish('constitution-initialize', [
    { path: repo.configSnapshot.path, before: repo.configSnapshot.source, after: configAfter },
    { path: CONSTITUTION_PATH, before: null, after: initialConstitutionSource({ body: '# Project constitution\n\nNo project principles have been adopted. This constitution is a draft.\n' }) },
  ], dryRun);
}
// @concord-end
