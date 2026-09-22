// @concord-file
// @concord-implements docs/feature/project-onboarding/use-case/evolve-constitution.md
import { Predicate, Schema } from 'effect';
import { parseDocument, stringify } from 'yaml';
import { ConcordError, ProjectSchema, Slug, Text, decode, digest, type Finding, type MutationReceipt, type Repository } from './shared.js';
import { renderTypeScriptConfig } from './config.js';

const DateText = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u));
const Version = Schema.String.check(Schema.isPattern(/^\d+\.\d+\.\d+$/u));
const Amendment = Schema.Struct({ date: DateText, reason: Text, sources: Schema.Array(Text), impact: Text });
export const ConstitutionSchema = Schema.Struct({
  format: Schema.Literal('concord.constitution/v1'), status: Schema.Literals(['draft', 'active']),
  ratifiedAt: Schema.NullOr(DateText), amendedAt: DateText, amendments: Schema.Array(Amendment),
});
const LegacyConstitutionSchema = Schema.Struct({
  format: Schema.Literal('concord.constitution/v1'), status: Schema.Literals(['draft', 'active']), version: Version,
  ratifiedAt: Schema.NullOr(DateText), amendedAt: DateText,
  amendments: Schema.Array(Schema.Struct({ version: Version, date: DateText, reason: Text, sources: Schema.Array(Text), impact: Text })),
});
export type ConstitutionMeta = typeof ConstitutionSchema.Type;
export interface ConstitutionRecord { readonly path: 'docs/constitution.md'; readonly source: string; readonly metadata: ConstitutionMeta; readonly body: string; readonly digest: string; readonly anchors: readonly string[] }

export function constitutionAnchors(body: string): string[] {
  const anchors: string[] = [];
  let fence: { readonly marker: '`' | '~'; readonly length: number } | undefined;
  let comment = false;
  let codeSpan = 0;
  for (const rawLine of body.split(/\r?\n/u)) {
    if (fence !== undefined) {
      const closing = /^( {0,3})(`+|~+)\s*$/u.exec(rawLine);
      if (closing !== null && closing[2]![0] === fence.marker && closing[2]!.length >= fence.length) fence = undefined;
      continue;
    }
    if (!comment && codeSpan === 0) {
      const opening = /^( {0,3})(`{3,}|~{3,})(?:[^\n]*)$/u.exec(rawLine);
      if (opening !== null) {
        fence = { marker: opening[2]![0] as '`' | '~', length: opening[2]!.length };
        continue;
      }
    }
    let visible = '';
    for (let index = 0; index < rawLine.length;) {
      if (comment) {
        const end = rawLine.indexOf('-->', index);
        if (end < 0) { index = rawLine.length; continue; }
        comment = false; index = end + 3; continue;
      }
      if (codeSpan > 0) {
        if (rawLine[index] !== '`') { index += 1; continue; }
        let end = index;
        while (rawLine[end] === '`') end += 1;
        if (end - index === codeSpan) codeSpan = 0;
        index = end; continue;
      }
      if (rawLine.startsWith('<!--', index)) { comment = true; index += 4; continue; }
      if (rawLine[index] === '`') {
        let end = index;
        while (rawLine[end] === '`') end += 1;
        codeSpan = end - index; index = end; continue;
      }
      visible += rawLine[index]!; index += 1;
    }
    if (/^(?: {4,}|\t)/u.test(rawLine)) continue;
    const match = /^<a id="([a-z0-9]+(?:-[a-z0-9]+)*)"><\/a>$/u.exec(visible);
    if (match !== null) anchors.push(decode(Slug, match[1], 'constitution clause'));
  }
  if (new Set(anchors).size !== anchors.length) throw new ConcordError('DuplicateConstitutionAnchor', 'Constitution clause anchors must be unique');
  return anchors;
}

export function parseConstitution(source: string): ConstitutionRecord {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/u.exec(source);
  if (match === null) throw new ConcordError('InvalidConstitution', 'docs/constitution.md requires strict YAML frontmatter');
  const yaml = parseDocument(match[1]!, { uniqueKeys: true, merge: false });
  if (yaml.errors.length > 0) throw new ConcordError('InvalidConstitution', yaml.errors.map((error) => error.message).join('; '));
  const value: unknown = yaml.toJS({ maxAliasCount: 0 });
  if (!Predicate.isObject(value)) throw new ConcordError('InvalidConstitution', 'Constitution frontmatter must be an object');
  const metadata = 'version' in value ? (() => {
    const legacy = decode(LegacyConstitutionSchema, value, 'docs/constitution.md');
    return decode(ConstitutionSchema, {
      format: legacy.format, status: legacy.status, ratifiedAt: legacy.ratifiedAt, amendedAt: legacy.amendedAt,
      amendments: legacy.amendments.map(({ date, reason, sources, impact }) => ({ date, reason, sources, impact })),
    }, 'docs/constitution.md');
  })() : decode(ConstitutionSchema, value, 'docs/constitution.md');
  if ((metadata.status === 'draft') !== (metadata.ratifiedAt === null)) throw new ConcordError('InvalidConstitution', 'draft requires ratifiedAt:null and active requires a ratified date');
  const body = match[2]!.replace(/^\r?\n/u, '');
  const anchors = constitutionAnchors(body);
  if (metadata.status === 'active' && anchors.length === 0) throw new ConcordError('InvalidConstitution', 'An active constitution requires at least one real clause anchor');
  return { path: 'docs/constitution.md', source, metadata, body, digest: digest(source), anchors };
}

function render(metadata: ConstitutionMeta, body: string): string {
  const valid = decode(ConstitutionSchema, metadata, 'constitution metadata');
  if (body.trim().length === 0) throw new ConcordError('InvalidConstitution', 'Constitution body must be non-empty');
  constitutionAnchors(body);
  return `---\n${stringify(valid, { lineWidth: 0 }).trimEnd()}\n---\n\n${body.endsWith('\n') ? body : `${body}\n`}`;
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
  if (active && constitutionAnchors(options.body).length === 0) throw new ConcordError('InvalidConstitution', 'Adopting the constitution requires a body with at least one real clause anchor');
  const amendments = active ? [{ date, reason: required(options.reason!, 'reason'), sources: (options.sources ?? []).map((source) => required(source, 'source')), impact: required(options.impact!, 'impact') }] : [];
  const metadata = decode(ConstitutionSchema, {
    format: 'concord.constitution/v1', status: active ? 'active' : 'draft',
    ratifiedAt: active ? date : null, amendedAt: date, amendments,
  }, 'constitution initialization');
  const source = render(metadata, options.body);
  parseConstitution(source);
  return source;
}

export function showConstitution(repo: Repository): ConstitutionRecord {
  const source = repo.read('docs/constitution.md');
  if (source === undefined) throw new ConcordError('ConstitutionMissing', 'docs/constitution.md is missing; run concord constitution initialize for an existing project');
  return parseConstitution(source);
}

export function checkConstitution(repo: Repository): Finding[] {
  if (repo.config.constitution === undefined) return [];
  try {
    const record = showConstitution(repo);
    return record.metadata.status === 'draft' ? [{ code: 'ConstitutionDraft', path: record.path, message: 'The project constitution is structurally valid but still draft; adopt real principles explicitly.' }] : [];
  } catch (cause) {
    return [{ code: cause instanceof ConcordError ? cause.code : 'InvalidConstitution', path: 'docs/constitution.md', message: cause instanceof Error ? cause.message : String(cause) }];
  }
}

function required(value: string, field: string): string {
  if (value.trim() !== value || value.length === 0) throw new ConcordError('InvalidInput', `${field} must be non-empty without surrounding whitespace`);
  return decode(Text, value, field);
}

export function adoptConstitution(repo: Repository, body: string, reason: string, impact: string, sources: readonly string[], expectedDigest: string, dryRun = false): MutationReceipt {
  const current = showConstitution(repo);
  if (current.digest !== expectedDigest) throw new ConcordError('PreimageChanged', 'docs/constitution.md changed; reload it and retry');
  if (current.metadata.status !== 'draft') throw new ConcordError('ConstitutionAlreadyActive', 'Use constitution amend for an active constitution');
  if (constitutionAnchors(body).length === 0) throw new ConcordError('InvalidConstitution', 'Adoption requires at least one real clause anchor');
  const date = new Date().toISOString().slice(0, 10);
  const entry = { date, reason: required(reason, 'reason'), sources: sources.map((source) => required(source, 'source')), impact: required(impact, 'impact') };
  const metadata = decode(ConstitutionSchema, { ...current.metadata, status: 'active', ratifiedAt: date, amendedAt: date, amendments: [...current.metadata.amendments, entry] }, 'constitution adoption');
  return repo.publish('constitution-adopt', [{ path: current.path, before: current.source, after: render(metadata, body) }], dryRun);
}

export function amendConstitution(repo: Repository, body: string, reason: string, impact: string, sources: readonly string[], expectedDigest: string, dryRun = false): MutationReceipt {
  const current = showConstitution(repo);
  if (current.digest !== expectedDigest) throw new ConcordError('PreimageChanged', 'docs/constitution.md changed; reload it and retry');
  if (current.metadata.status !== 'active') throw new ConcordError('ConstitutionNotActive', 'Adopt the draft constitution before amending it');
  if (constitutionAnchors(body).length === 0) throw new ConcordError('InvalidConstitution', 'An active constitution requires at least one clause anchor');
  const date = new Date().toISOString().slice(0, 10);
  const entry = { date, reason: required(reason, 'reason'), sources: sources.map((source) => required(source, 'source')), impact: required(impact, 'impact') };
  const metadata = decode(ConstitutionSchema, { ...current.metadata, amendedAt: date, amendments: [...current.metadata.amendments, entry] }, 'constitution amendment');
  return repo.publish('constitution-amend', [{ path: current.path, before: current.source, after: render(metadata, body) }], dryRun);
}

export function initializeConstitution(repo: Repository, dryRun = false): MutationReceipt {
  if (repo.read('docs/constitution.md') !== undefined) throw new ConcordError('ConstitutionExists', 'docs/constitution.md already exists');
  const next = decode(ProjectSchema, { ...repo.config, constitution: { path: 'docs/constitution.md' } }, 'constitution configuration');
  const configAfter = renderTypeScriptConfig(next);
  return repo.publish('constitution-initialize', [
    { path: repo.configSnapshot.path, before: repo.configSnapshot.source, after: configAfter },
    { path: 'docs/constitution.md', before: null, after: initialConstitutionSource({ body: '# Project constitution\n\nNo project principles have been adopted. This constitution is a draft.\n' }) },
  ], dryRun);
}
