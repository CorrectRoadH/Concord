import { posix } from 'node:path';
import type { Heading, Nodes, Paragraph, RootContent } from 'mdast';
import { Predicate } from 'effect';
import { parseDocument } from 'yaml';
import { CONSTITUTION_PATH, clauseIndex, constitutionLinkTarget, inlineLinks, parseConstitution, trailingId } from './constitution.js';
import { LegacyConstitutionSchema } from './constitution-schema.js';
import { decodeDocumentSource } from './document-codec.js';
import { fromMarkdown } from './markdown-parser.js';
import { parseReference } from './refs.js';
import { ConcordError, canonical, decode, type Change, type Repository } from './shared.js';
import { markdownAnchor, markdownBody } from './steps.js';

interface Edit { readonly start: number; readonly end: number; readonly text: string }
const apply = (source: string, edits: readonly Edit[]) => [...edits].sort((left, right) => right.start - left.start).reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), source);
const conflict = (message: string): never => { throw new ConcordError('ConstitutionMigrationConflict', message); };
const plainHeading = (source: string, node: Heading) => source.slice(node.children[0]?.position?.start.offset ?? node.position!.start.offset, node.children.at(-1)?.position?.end.offset ?? node.position!.end.offset).trim();

function splitFrontmatter(path: string, source: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(source);
  if (match === null) return undefined;
  const yaml = parseDocument(match[1]!, { uniqueKeys: true, merge: false });
  if (yaml.errors.length > 0) throw new ConcordError('InvalidData', `${path}: ${yaml.errors.map(error => error.message).join('; ')}`);
  const value: unknown = yaml.toJS({ maxAliasCount: 100 });
  return { yaml: match[1]!, value, start: match[0].indexOf(match[1]!), end: match[0].indexOf(match[1]!) + match[1]!.length };
}

// @concord-begin
// @concord-implements docs/feature/project-onboarding/use-case/evolve-constitution.md#迁移旧格式
/** The only v1 reader: `<a id>` lines become heading IDs, root ordered items get positional paragraph IDs. */
export function migrateConstitutionSource(source: string): string {
  const head = splitFrontmatter(CONSTITUTION_PATH, source);
  if (head === undefined || !Predicate.isObject(head.value)) throw new ConcordError('InvalidConstitution', 'docs/constitution.md requires strict YAML frontmatter');
  if (head.value.format !== 'concord.constitution/v1') return source;
  decode(LegacyConstitutionSchema, head.value, CONSTITUTION_PATH);
  const masked = markdownBody(source);
  const nodes = fromMarkdown(masked).children;
  const edits: Edit[] = [{ start: head.start, end: head.end, text: head.yaml.replace(/^format:[ \t]*concord\.constitution\/v1[ \t]*$/mu, 'format: concord.constitution/v2') }];
  const seen = new Set<string>();
  let section: { readonly id: string; count: number } | undefined;
  const nextHeading = (index: number): RootContent | undefined => nodes[index + 1];
  for (const [index, node] of nodes.entries()) {
    if (node.type === 'paragraph') {
      const raw = masked.slice(node.position!.start.offset, node.position!.end.offset);
      const anchor = /^<a id="([a-z0-9]+(?:-[a-z0-9]+)*)"><\/a>$/u.exec(raw)?.[1];
      if (anchor === undefined) continue;
      if (seen.has(anchor)) conflict(`Duplicate constitution anchor ${anchor}`);
      seen.add(anchor);
      const heading = nextHeading(index);
      if (heading?.type !== 'heading' || heading.depth !== 2 || heading.position!.start.line !== node.position!.end.line + 1) conflict(`Anchor ${anchor} on line ${node.position!.start.line} is not followed by an H2 clause heading`);
      const target = heading as Heading;
      if (trailingId(masked, target) !== undefined) conflict(`Clause heading on line ${target.position!.start.line} already has an ID`);
      edits.push({ start: node.position!.start.offset!, end: target.position!.start.offset!, text: '' });
      edits.push({ start: target.children.at(-1)!.position!.end.offset!, end: target.children.at(-1)!.position!.end.offset!, text: ` {#${anchor}}` });
      section = { id: anchor, count: 0 };
    } else if (node.type === 'heading') {
      if (node.depth > 2) continue;
      const previous = nodes[index - 1];
      const anchored = previous?.type === 'paragraph' && /^<a id="[^"]+"><\/a>$/u.test(masked.slice(previous.position!.start.offset, previous.position!.end.offset)) && previous.position!.end.line + 1 === node.position!.start.line;
      if (anchored) continue;
      section = undefined;
      if (node.depth === 2 && plainHeading(masked, node) === '总则' && trailingId(masked, node) === undefined) {
        edits.push({ start: node.children.at(-1)!.position!.end.offset!, end: node.children.at(-1)!.position!.end.offset!, text: ' {#general}' });
        section = { id: 'general', count: 0 };
      }
    } else if (node.type === 'list' && node.ordered === true && section !== undefined) {
      for (const item of node.children) {
        section.count += 1;
        const first = item.children[0];
        if (first?.type !== 'paragraph') conflict(`Paragraph ${section.count} of ${section.id} does not start with text`);
        const paragraph = first as Paragraph;
        if (trailingId(masked, paragraph) !== undefined) continue;
        edits.push({ start: paragraph.position!.end.offset!, end: paragraph.position!.end.offset!, text: ` {#${section.id}-${section.count}}` });
      }
    }
  }
  const next = apply(source, edits);
  try { parseConstitution(next); }
  catch (cause) { conflict(`Migrated constitution is not valid: ${cause instanceof Error ? cause.message : String(cause)}`); }
  return next;
}

/** Headings whose explicit ID or slug alias is `constitution`, at any depth. */
function constitutionAnchorCount(masked: string): number {
  let count = 0;
  const visit = (node: Nodes): void => {
    if (node.type === 'heading') {
      const raw = masked.slice(node.position!.start.offset, node.position!.end.offset);
      const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/u.exec(raw)?.[1];
      const explicit = heading === undefined ? undefined : /\s+\{#([^{}\s]+)\}\s*$/u.exec(heading)?.[1];
      const slug = explicit ?? (heading === undefined ? undefined : markdownAnchor(`## ${heading}`));
      if (slug !== undefined && (slug === 'constitution' || slug.replace(/-+/gu, '-').replace(/^-+|-+$/gu, '') === 'constitution')) count += 1;
    } else if ('children' in node) node.children.forEach(visit);
  };
  visit(fromMarkdown(masked));
  return count;
}

interface OwnerPlan { readonly change: Change; readonly moved: number }

/** Remove `constitutionRefs` and project each clause into the owner's single `## Constitution` section. */
export function migrateOwnerSource(path: string, source: string): OwnerPlan | undefined {
  const head = splitFrontmatter(path, source);
  if (head === undefined || !Predicate.isObject(head.value) || typeof head.value.format !== 'string' || !head.value.format.startsWith('concord.document/')) return undefined;
  if ((head.value.kind !== 'feature' && head.value.kind !== 'design') || !Object.hasOwn(head.value, 'constitutionRefs')) return undefined;
  const refs = head.value.constitutionRefs;
  if (!Array.isArray(refs) || !refs.every(ref => typeof ref === 'string')) throw new ConcordError('InvalidData', `${path}: constitutionRefs must be a string array`);
  const clauses = [...new Set((refs as string[]).map(ref => {
    const parsed = parseReference(ref);
    if (parsed.path !== CONSTITUTION_PATH || parsed.anchor === undefined) throw new ConcordError('InvalidConstitutionRef', `${path}: expected docs/constitution.md#<clause>, got ${ref}`);
    return parsed.anchor;
  }))];
  const yaml = head.yaml.replace(/^constitutionRefs:[^\n]*(?:\r?\n(?:[ \t]+[^\n]*|-[^\n]*))*(?:\r?\n|$)/mu, '');
  const stripped = source.slice(0, head.start) + yaml.replace(/\r?\n$/u, '') + source.slice(head.end);
  const { constitutionRefs: _, ...expected } = head.value;
  const reparsed = splitFrontmatter(path, stripped);
  if (reparsed === undefined || canonical(reparsed.value) !== canonical(expected)) conflict(`${path}: constitutionRefs is not a removable top-level block`);
  decodeDocumentSource(path, stripped);
  const masked = markdownBody(stripped);
  const roots = fromMarkdown(masked).children;
  const sections = roots.flatMap((node, index) => node.type === 'heading' && node.depth === 2 && plainHeading(masked, node) === 'Constitution' ? [index] : []);
  if (sections.length > 1) conflict(`${path} has more than one ## Constitution section`);
  const linked = new Set(inlineLinks(stripped).flatMap(link => { const target = constitutionLinkTarget(path, link.url); return target?.kind === 'fragment' ? [target.id] : []; }));
  const needed = clauses.filter(id => !linked.has(id));
  if (needed.length === 0) return { change: { path, before: source, after: stripped }, moved: refs.length };
  if (constitutionAnchorCount(masked) > sections.length) conflict(`${path}: the ## Constitution heading slug collides with another anchor named constitution`);
  const relative = posix.relative(posix.dirname(path), CONSTITUTION_PATH);
  const lines = needed.map(id => `- [${id.toUpperCase()}](${relative}#${id})`).join('\n');
  let after: string;
  if (sections.length === 0) after = `${stripped.replace(/\s*$/u, '')}\n\n## Constitution\n\n${lines}\n`;
  else {
    const start = sections[0]!;
    const end = roots.slice(start + 1).find(node => node.type === 'heading' && node.depth <= 2)?.position?.start.offset ?? stripped.length;
    const content = stripped.slice(0, end).replace(/\s*$/u, '');
    const joiner = /^\s*[-*+] /u.test(content.slice(content.lastIndexOf('\n') + 1)) ? '\n' : '\n\n';
    const rest = stripped.slice(end);
    after = `${content}${joiner}${lines}\n${rest.length > 0 ? `\n${rest}` : ''}`;
  }
  return { change: { path, before: source, after }, moved: refs.length };
}

export interface ConstitutionMigrationReceipt { readonly operation: 'constitution-migrate'; readonly dryRun: boolean; readonly changedPaths: readonly string[]; readonly clauses: number; readonly paragraphs: number; readonly movedReferences: number; readonly recoveryRequired?: boolean }

/** Plans every file before writing; any failure leaves the worktree untouched. */
export function migrateConstitution(repo: Repository, dryRun = false): ConstitutionMigrationReceipt {
  const source = repo.read(CONSTITUTION_PATH);
  if (source === undefined) throw new ConcordError('ConstitutionMissing', 'docs/constitution.md is missing');
  const next = migrateConstitutionSource(source);
  const clauses = parseConstitution(next).clauses;
  const changes: Change[] = next === source ? [] : [{ path: CONSTITUTION_PATH, before: source, after: next }];
  let movedReferences = 0;
  for (const path of repo.files('docs').filter(file => file.endsWith('.md') && file !== CONSTITUTION_PATH && !file.startsWith('docs/_template/')).sort()) {
    const owner = repo.read(path);
    if (owner === undefined) throw new ConcordError('SourceChanged', `${path} disappeared while the migration was planned`);
    const plan = migrateOwnerSource(path, owner);
    if (plan === undefined) continue;
    changes.push(plan.change);
    movedReferences += plan.moved;
  }
  const index = clauseIndex(clauses);
  const receipt = changes.length === 0 ? { operation: 'constitution-migrate', dryRun, changedPaths: [] } : repo.publish('constitution-migrate', changes, dryRun);
  return {
    operation: 'constitution-migrate', dryRun: receipt.dryRun, changedPaths: receipt.changedPaths,
    clauses: clauses.filter(clause => clause.id !== 'general').length,
    paragraphs: [...index.values()].filter(entry => entry.paragraph !== null).length,
    movedReferences,
    ...(receipt.recoveryRequired === true ? { recoveryRequired: true } : {}),
  };
}
// @concord-end
