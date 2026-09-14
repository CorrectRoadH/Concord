// @concord-file document-contract-operations
// @concord-implements docs/feature/local-sdlc/README.md
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import { posix } from 'node:path';
import { Predicate, Schema } from 'effect';
import { parseDocument, stringify } from 'yaml';
import {
  ConcordError,
  DocumentSchema,
  Slug,
  Text,
  decode,
  digest,
  type DocumentKind,
  type DocumentMeta,
  type DocumentRecord,
  type Finding,
  type FixedProof,
  type MemoryMeta,
  type MutationReceipt,
  type Repository,
  type Resolution,
} from './shared.js';
import {
  lifecycleHistory,
  promotedMemory,
  reopenedMemory,
  resolvedMemory,
  retiredPromotion,
  supersededMemory,
} from './memory-state.js';
import { parseReference, resolveReference } from './refs.js';
import { templateBody, TEMPLATE_PAGES } from './templates.js';
import { rebaseAdoptedMarkdown } from './adoption.js';

export const DOCUMENT_ROOTS = ['docs/feature', 'docs/roadmap', 'docs/design', 'docs/research', 'docs/engineering', 'docs/issues', 'memory'] as const;
const CONTRACT_KINDS: readonly DocumentKind[] = ['feature', 'use-case', 'roadmap', 'engineering'];
const now = (): string => new Date().toISOString();

function required(value: string | undefined, field: string): string {
  if (value === undefined || value.length === 0 || value.trim() !== value) throw new ConcordError('InvalidInput', `${field} must be non-empty and have no surrounding whitespace`);
  return decode(Text, value, field);
}

function authorBody(value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new ConcordError('InvalidInput', 'body must be non-empty');
  const body = value;
  if (/^(?:\uFEFF)?---(?:\r?\n|$)/u.test(body)) throw new ConcordError('InvalidAuthorBody', 'Author body cannot contain a leading YAML frontmatter block');
  return body.endsWith('\n') ? body : `${body}\n`;
}

export function parseDocumentRecord(path: string, source: string): DocumentRecord | undefined {
  if (!/^---\r?\n/u.test(source)) return undefined;
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/u.exec(source);
  const frontmatter = match?.[1] ?? source.slice(0, 64 * 1024);
  const claimsConcord = /(?:^|\n)\s*format\s*:[^\n]*concord\.document\//u.test(frontmatter);
  if (match === null) {
    if (claimsConcord) throw new ConcordError('InvalidData', `${path}: unterminated Concord frontmatter`);
    return undefined;
  }
  const yaml = parseDocument(match[1]!, { uniqueKeys: true, merge: false });
  if (yaml.errors.length > 0) {
    if (claimsConcord) throw new ConcordError('InvalidData', `${path}: ${yaml.errors.map(error => error.message).join('; ')}`);
    return undefined;
  }
  const value: unknown = yaml.toJS({ maxAliasCount: 0 });
  if (!Predicate.isObject(value) || typeof value.format !== 'string') {
    if (claimsConcord) throw new ConcordError('InvalidData', `${path}: invalid Concord frontmatter`);
    return undefined;
  }
  if (!value.format.startsWith('concord.document/')) return undefined;
  const metadata = decode(DocumentSchema, value, path);
  const rawBody = match[2]!.replace(/^\r?\n/u, '');
  return { path, metadata, body: rawBody, digest: digest(source) };
}

export function renderDocument(metadata: DocumentMeta, body: string): string {
  const valid = decode(DocumentSchema, metadata, `${metadata.kind}:${metadata.id}`);
  return `---\n${stringify(valid, { lineWidth: 0 }).trimEnd()}\n---\n\n${authorBody(body)}`;
}

function expectedPath(metadata: DocumentMeta, documents: readonly DocumentRecord[]): string | undefined {
  switch (metadata.kind) {
    case 'feature': return `docs/feature/${metadata.id}/README.md`;
    case 'roadmap': return `docs/roadmap/${metadata.id}/README.md`;
    case 'design': return `docs/design/${metadata.id}/README.md`;
    case 'engineering': return `docs/engineering/${metadata.id}/README.md`;
    case 'research': return `docs/research/${metadata.id}.md`;
    case 'memory': return `memory/${metadata.id}.md`;
    case 'issue': return `docs/issues/${metadata.id}.md`;
    case 'use-case': {
      try {
        const feature = findDocument(documents, metadata.feature, 'feature');
        return `docs/feature/${feature.metadata.id}/use-case/${metadata.id}.md`;
      } catch { return undefined; }
    }
  }
}

function changed(repo: Repository, operation: string, record: DocumentRecord, metadata: DocumentMeta, body = record.body, dryRun = false): MutationReceipt {
  return repo.publish(operation, [{ path: record.path, before: preimage(repo, record), after: renderDocument(metadata, body) }], dryRun);
}

function preimage(repo: Repository, record: DocumentRecord): string {
  const source = repo.read(record.path);
  if (source === undefined || digest(source) !== record.digest) throw new ConcordError('PreimageChanged', `${record.path} changed; reload the document and retry`);
  return source;
}

function memory(record: DocumentRecord): MemoryMeta {
  if (record.metadata.kind !== 'memory') throw new ConcordError('InvalidDocumentKind', `${record.path} is not Memory`);
  return record.metadata;
}

export function loadDocuments(repo: Repository): DocumentRecord[] {
  const paths = new Set<string>();
  for (const root of DOCUMENT_ROOTS) for (const path of repo.files(root)) if (path.endsWith('.md')) paths.add(path);
  const documents: DocumentRecord[] = [];
  for (const path of [...paths].sort()) {
    const source = repo.read(path);
    if (source === undefined) continue;
    const record = parseDocumentRecord(path, source);
    if (record !== undefined) documents.push(record);
  }
  return documents;
}

export function findDocument(documents: readonly DocumentRecord[], selector: string, kind?: DocumentKind): DocumentRecord {
  required(selector, 'selector');
  if (selector.includes('/')) {
    const parsed = parseReference(selector);
    if (parsed.anchor !== undefined) throw new ConcordError('InvalidReference', 'Document selectors cannot contain anchors');
  } else decode(Slug, selector, 'selector');
  const pool = kind === undefined ? documents : documents.filter(document => document.metadata.kind === kind);
  const exact = pool.filter(document => document.path === selector);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) throw new ConcordError('AmbiguousDocument', `More than one document has path ${selector}`);
  const byId = pool.filter(document => document.metadata.id === selector);
  if (byId.length === 0) throw new ConcordError('DocumentNotFound', `No${kind === undefined ? '' : ` ${kind}`} document matches ${selector}`);
  if (byId.length > 1) throw new ConcordError('AmbiguousDocument', `Document id ${selector} is ambiguous; use its canonical path`);
  return byId[0]!;
}

export { resolveReference } from './refs.js';

function finding(findings: Finding[], code: string, path: string, message: string): void {
  findings.push({ code, path, message });
}

function checkRef(
  findings: Finding[], repo: Repository, documents: readonly DocumentRecord[], owner: DocumentRecord,
  ref: string, kinds: readonly DocumentKind[], label: string,
): DocumentRecord | undefined {
  try { return resolveReference(repo, documents, ref, kinds); }
  catch (cause) { finding(findings, cause instanceof ConcordError ? cause.code : 'InvalidReference', owner.path, `${label}: ${cause instanceof Error ? cause.message : String(cause)}`); return undefined; }
}

export function checkDocuments(repo: Repository, documents: readonly DocumentRecord[]): Finding[] {
  const findings: Finding[] = [];
  const identities = new Map<string, DocumentRecord[]>();
  for (const document of documents) {
    const key = `${document.metadata.kind}:${document.metadata.id}`;
    identities.set(key, [...(identities.get(key) ?? []), document]);
    const expected = expectedPath(document.metadata, documents);
    if (expected === undefined) finding(findings, 'InvalidPlacement', document.path, 'Owner relationship is invalid, so its canonical placement cannot be determined');
    else if (expected !== document.path) finding(findings, 'InvalidPlacement', document.path, `Expected ${expected}`);

    const metadata = document.metadata;
    if (metadata.kind === 'use-case') checkRef(findings, repo, documents, document, metadata.feature, ['feature'], 'feature');
    if (metadata.kind === 'feature' && metadata.origin !== undefined) {
      const origin = checkRef(findings, repo, documents, document, metadata.origin, ['roadmap'], 'origin');
      if (origin?.metadata.kind === 'roadmap' && (origin.metadata.state !== 'adopted' || origin.metadata.adoptedAs !== document.path)) {
        finding(findings, 'InvalidState', document.path, 'Feature origin does not identify a Roadmap adopted as this Feature');
      }
    }
    if (metadata.kind === 'design') {
      if (new Set(metadata.alternatives).size !== metadata.alternatives.length) finding(findings, 'InvalidState', document.path, 'Design alternatives must be unique');
      if (metadata.decision !== undefined) {
        if (!metadata.alternatives.includes(metadata.decision.selected)) finding(findings, 'InvalidState', document.path, 'Selected alternative is not declared');
        if (new Set(metadata.decision.targets).size !== metadata.decision.targets.length) finding(findings, 'InvalidState', document.path, 'Design decision targets must be unique');
        for (const target of metadata.decision.targets) checkRef(findings, repo, documents, document, target, CONTRACT_KINDS, 'decision target');
      }
    }
    if (metadata.kind === 'roadmap') {
      if (metadata.state === 'planned' && metadata.adoptedAs !== undefined) finding(findings, 'InvalidState', document.path, 'Planned Roadmap cannot have adoptedAs');
      if (metadata.state === 'adopted' && metadata.adoptedAs === undefined) finding(findings, 'InvalidState', document.path, 'Adopted Roadmap must identify its Feature');
      if (metadata.adoptedAs !== undefined) checkRef(findings, repo, documents, document, metadata.adoptedAs, ['feature'], 'adoptedAs');
    }
    if (metadata.kind === 'memory') {
      const problem = metadata.memoryKind === 'problem';
      if (problem && metadata.state === 'open' && metadata.resolution !== undefined) finding(findings, 'InvalidState', document.path, 'Open Problem cannot have a current resolution');
      if (problem && (metadata.state !== 'open' && metadata.state !== 'resolved')) finding(findings, 'InvalidState', document.path, 'Problem state must be open or resolved');
      if (problem && metadata.state === 'resolved' && metadata.resolution === undefined) finding(findings, 'InvalidState', document.path, 'Resolved Problem must have a resolution');
      if (metadata.resolution !== undefined && metadata.resolution.epoch !== metadata.epoch) finding(findings, 'InvalidState', document.path, 'Resolution epoch does not match current Problem epoch');
      if (metadata.resolution?.kind === 'fixed' && (metadata.resolution.evidenceLevel !== 'command' || !metadata.resolution.red || !metadata.resolution.green || !metadata.resolution.selectedCaseId)) finding(findings, 'InvalidState', document.path, 'Fixed resolution lacks complete command evidence');
      if (metadata.resolution !== undefined && metadata.resolution.kind !== 'fixed' && metadata.resolution.evidenceLevel !== 'author') finding(findings, 'InvalidState', document.path, 'Non-fixed resolution must use author evidence');
      if (!problem && (metadata.state !== 'current' && metadata.state !== 'superseded')) finding(findings, 'InvalidState', document.path, 'Decision/Insight state must be current or superseded');
      if (!problem && metadata.state === 'current' && metadata.supersededBy !== undefined) finding(findings, 'InvalidState', document.path, 'Current Memory cannot have supersededBy');
      if (!problem && metadata.state === 'superseded' && metadata.supersededBy === undefined) finding(findings, 'InvalidState', document.path, 'Superseded Memory must identify its replacement');
      if (new Set(metadata.promotions).size !== metadata.promotions.length) finding(findings, 'InvalidState', document.path, 'Current promotions must be unique');
      for (const target of metadata.promotions) {
        const resolved = checkRef(findings, repo, documents, document, target, CONTRACT_KINDS, 'promotion');
        if (resolved?.metadata.kind === 'roadmap' && resolved.metadata.state !== 'planned') finding(findings, 'InvalidState', document.path, `Promotion targets adopted Roadmap ${target}`);
      }
      if (metadata.supersededBy !== undefined) {
        const replacement = checkRef(findings, repo, documents, document, metadata.supersededBy, ['memory'], 'supersededBy');
        if (replacement?.metadata.kind === 'memory' && replacement.metadata.memoryKind !== metadata.memoryKind) finding(findings, 'InvalidState', document.path, 'Replacement Memory has a different kind');
      }
    }
    if (metadata.kind === 'issue') {
      if (new Set(metadata.memories).size !== metadata.memories.length) finding(findings, 'InvalidState', document.path, 'Issue Memory links must be unique');
      if (new Set(metadata.features ?? []).size !== (metadata.features ?? []).length) finding(findings, 'InvalidState', document.path, 'Feedback Feature links must be unique');
      for (const target of metadata.memories) {
        checkRef(findings, repo, documents, document, target, ['memory'], 'linked Memory');
      }
      for (const target of metadata.features ?? []) checkRef(findings, repo, documents, document, target, ['feature'], 'linked Feature');
    }
  }
  const feedbackSources = new Map<string, string>();
  for (const document of documents) if (document.metadata.kind === 'issue' && document.metadata.source !== undefined) {
    const source = document.metadata.source;
    const identity = source.provider === 'linear' ? `${source.provider}\u0000${source.instance}\u0000${source.organizationId}\u0000${source.id}` : `${source.provider}\u0000${source.instance}\u0000${source.id}`;
    const prior = feedbackSources.get(identity);
    if (prior !== undefined) finding(findings, 'DuplicateFeedbackSource', document.path, `Remote feedback source is already owned by ${prior}`);
    else feedbackSources.set(identity, document.path);
  }
  for (const [identity, matches] of identities) if (matches.length > 1) for (const match of matches) finding(findings, 'DuplicateIdentity', match.path, `${identity} is not unique`);

  for (const start of documents.filter(document => document.metadata.kind === 'memory')) {
    const seen = new Set<string>(); let cursor: DocumentRecord | undefined = start;
    while (cursor?.metadata.kind === 'memory' && cursor.metadata.supersededBy !== undefined) {
      if (seen.has(cursor.path)) { finding(findings, 'ReferenceCycle', start.path, 'Memory supersession contains a cycle'); break; }
      seen.add(cursor.path);
      try { cursor = resolveReference(repo, documents, cursor.metadata.supersededBy, ['memory']); } catch { break; }
    }
  }
  return findings.sort((left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code));
}

export interface CreateDocumentInput {
  readonly id: string;
  readonly title: string;
  readonly body?: string;
  readonly feature?: string;
  readonly observedAt?: string;
  readonly sources?: readonly string[];
  readonly alternatives?: readonly string[];
  readonly pages?: readonly string[];
  readonly memoryKind?: 'problem' | 'decision' | 'insight';
  readonly dryRun?: boolean;
}

// @concord-code create-contract-owner
// @concord-implements docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
export function createDocument(repo: Repository, kind: DocumentKind, input: CreateDocumentInput): MutationReceipt {
  const id = decode(Slug, input.id, 'id');
  const title = required(input.title, 'title');
  if (input.feature !== undefined && kind !== 'use-case') throw new ConcordError('InvalidInput', 'feature is only valid for use-case');
  if ((input.observedAt !== undefined || (input.sources?.length ?? 0) > 0) && kind !== 'research') throw new ConcordError('InvalidInput', 'observedAt and sources are only valid for research');
  if ((input.alternatives?.length ?? 0) > 0 && kind !== 'design') throw new ConcordError('InvalidInput', 'alternatives are only valid for design');
  if (input.memoryKind !== undefined && kind !== 'memory') throw new ConcordError('InvalidInput', 'memoryKind is only valid for memory');
  if (input.pages !== undefined && !['feature', 'roadmap', 'design'].includes(kind)) throw new ConcordError('InvalidInput', 'pages is only valid for feature, roadmap, and design');
  const selected = decode(Schema.Array(Schema.Literals(TEMPLATE_PAGES)), input.pages ?? [], 'pages');
  if (new Set(selected).size !== selected.length) throw new ConcordError('InvalidInput', 'pages must be unique');
  const requested = TEMPLATE_PAGES.filter(page => selected.includes(page));
  const bodyFor = (name: string) => authorBody(input.body ?? templateBody(name, title, requested));
  const createdAt = now();
  const documents = loadDocuments(repo);
  if (documents.some(document => document.metadata.kind === kind && document.metadata.id === id)) {
    throw new ConcordError('DocumentExists', `${kind} id ${id} already exists; use its canonical path`);
  }
  let path: string;
  let metadata: DocumentMeta;
  let template: string = kind;
  switch (kind) {
    case 'feature': path = `docs/feature/${id}/README.md`; metadata = { format: 'concord.document/v1', id, title, createdAt, kind }; break;
    case 'use-case': {
      const feature = findDocument(documents, required(input.feature, 'feature'), 'feature');
      path = `docs/feature/${feature.metadata.id}/use-case/${id}.md`;
      metadata = { format: 'concord.document/v1', id, title, createdAt, kind, feature: feature.path };
      break;
    }
    case 'roadmap': path = `docs/roadmap/${id}/README.md`; metadata = { format: 'concord.document/v1', id, title, createdAt, kind, state: 'planned' }; break;
    case 'design': {
      const alternatives = input.alternatives?.map(value => decode(Slug, value, 'alternative')) ?? [];
      if (alternatives.length === 0 || new Set(alternatives).size !== alternatives.length) throw new ConcordError('InvalidInput', 'Design requires unique non-empty alternatives');
      path = `docs/design/${id}/README.md`; metadata = { format: 'concord.document/v1', id, title, createdAt, kind, alternatives: alternatives as [string, ...string[]] };
      break;
    }
    case 'engineering': path = `docs/engineering/${id}/README.md`; metadata = { format: 'concord.document/v1', id, title, createdAt, kind }; break;
    case 'research': path = `docs/research/${id}.md`; metadata = { format: 'concord.document/v1', id, title, createdAt, kind, observedAt: required(input.observedAt, 'observedAt'), sources: input.sources ?? [] }; break;
    case 'memory': {
      const memoryKind = input.memoryKind;
      if (memoryKind === undefined) throw new ConcordError('InvalidInput', 'memoryKind is required');
      path = `memory/${id}.md`;
      template = memoryKind;
      metadata = { format: 'concord.document/v1', id, title, createdAt, kind, memoryKind, state: memoryKind === 'problem' ? 'open' : 'current', epoch: 0, promotions: [], history: [] };
      break;
    }
    case 'issue': path = `docs/issues/${id}.md`; metadata = { format: 'concord.document/v1', id, title, createdAt, kind, state: 'draft', memories: [], history: [] }; break;
  }
  const body = bodyFor(template);
  const changes = [{ path, before: null, after: renderDocument(metadata, body) }];
  const allowed = kind === 'feature' || kind === 'roadmap';
  const add = (pagePath: string, name: string) => changes.push({ path: pagePath, before: null, after: authorBody(templateBody(name, title, requested)) });
  if (allowed) for (const page of requested) add(`${posix.dirname(path)}/${page === 'use-case' ? 'use-case/README.md' : `${page}.md`}`, page === 'use-case' ? 'use-case-index' : page);
  if (kind === 'design') {
    add(`docs/design/${id}/GOALS.md`, 'goals'); add(`docs/design/${id}/LIMITS.md`, 'limits'); add(`docs/design/${id}/DECISION.md`, 'decision-record');
    add(`docs/design/${id}/CASES.md`, 'cases');
    const alternatives = metadata.kind === 'design' ? metadata.alternatives : [];
    for (const alternative of alternatives) {
      const base = `docs/design/${id}/plans/${alternative}`;
      add(`${base}/README.md`, 'feature');
      for (const page of requested) add(`${base}/${page === 'use-case' ? 'use-case/README.md' : `${page}.md`}`, page === 'use-case' ? 'use-case-index' : page);
    }
  }
  for (const change of changes) if (repo.read(change.path) !== undefined) throw new ConcordError('DocumentExists', `${change.path} already exists`);
  return repo.publish(`create-${kind}`, changes, input.dryRun ?? false);
}

export { addPage, setPage, showPage } from './document-pages.js';

export function setAuthor(repo: Repository, ref: string, body: string, expectedDigest: string, dryRun = false): MutationReceipt {
  const record = resolveReference(repo, loadDocuments(repo), ref);
  if (record.path !== parseReference(ref).path) throw new ConcordError('InvalidReferenceTarget', 'Author body belongs to an exact Concord owner, not supporting Markdown');
  if (record.digest !== expectedDigest) throw new ConcordError('PreimageChanged', `${record.path} changed; use its current digest`);
  return changed(repo, 'set-author', record, record.metadata, authorBody(body), dryRun);
}

/** Updates only explicit author-owned metadata; lifecycle and identity remain domain operations. */
export function setDocumentMetadata(
  repo: Repository,
  reference: string,
  fields: { readonly title?: string; readonly observedAt?: string; readonly sources?: readonly string[] },
  expectedDigest: string,
  dryRun = false,
): MutationReceipt {
  if (fields.title === undefined && fields.observedAt === undefined && fields.sources === undefined) throw new ConcordError('InvalidInput', 'Provide at least one author metadata field');
  const record = resolveReference(repo, loadDocuments(repo), reference);
  if (record.path !== parseReference(reference).path) throw new ConcordError('InvalidReferenceTarget', 'Metadata belongs to an exact Concord owner, not supporting Markdown');
  if (record.digest !== expectedDigest) throw new ConcordError('PreimageChanged', `${record.path} changed; use its current digest`);
  if ((fields.observedAt !== undefined || fields.sources !== undefined) && record.metadata.kind !== 'research') {
    throw new ConcordError('InvalidDocumentKind', 'observedAt and sources are only author fields on Research documents');
  }
  const title = fields.title === undefined ? record.metadata.title : required(fields.title, 'title');
  if (record.metadata.kind !== 'research') return changed(repo, 'set-metadata', record, { ...record.metadata, title }, record.body, dryRun);
  const observedAt = fields.observedAt === undefined ? record.metadata.observedAt : required(fields.observedAt, 'observedAt');
  const sources = fields.sources === undefined ? record.metadata.sources : fields.sources.map((source, index) => required(source, `sources[${index}]`));
  return changed(repo, 'set-metadata', record, { ...record.metadata, title, observedAt, sources }, record.body, dryRun);
}

export function decideDesign(repo: Repository, selector: string, selected: string, targets: readonly string[], reason: string, dryRun = false): MutationReceipt {
  const documents = loadDocuments(repo); const record = findDocument(documents, selector, 'design');
  if (record.metadata.kind !== 'design') throw new ConcordError('InvalidDocumentKind', selector);
  if (record.metadata.decision !== undefined) throw new ConcordError('DecisionExists', 'A Design decision cannot be overwritten');
  const choice = decode(Slug, selected, 'selected');
  if (!record.metadata.alternatives.includes(choice)) throw new ConcordError('InvalidDecision', `${choice} is not a declared alternative`);
  const uniqueTargets = [...new Set(targets)];
  if (uniqueTargets.length !== targets.length) throw new ConcordError('InvalidDecision', 'Decision targets must be unique');
  for (const target of targets) resolveReference(repo, documents, target, CONTRACT_KINDS);
  return changed(repo, 'decide-design', record, { ...record.metadata, decision: { selected: choice, reason: required(reason, 'reason'), at: now(), targets } }, record.body, dryRun);
}

// @concord-code adopt-roadmap-contract
// @concord-implements docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
export function adoptRoadmap(repo: Repository, selector: string, featureId: string, dryRun = false): MutationReceipt {
  const documents = loadDocuments(repo); const roadmap = findDocument(documents, selector, 'roadmap');
  if (roadmap.metadata.kind !== 'roadmap') throw new ConcordError('InvalidDocumentKind', selector);
  if (roadmap.metadata.state !== 'planned') throw new ConcordError('InvalidRoadmapState', 'Roadmap is already adopted');
  const id = decode(Slug, featureId, 'featureId'); const featurePath = `docs/feature/${id}/README.md`;
  if (repo.read(featurePath) !== undefined) throw new ConcordError('DocumentExists', `${featurePath} already exists`);
  const at = now();
  const feature: DocumentMeta = { format: 'concord.document/v1', id, title: roadmap.metadata.title, createdAt: at, kind: 'feature', origin: roadmap.path };
  const adopted: DocumentMeta = { ...roadmap.metadata, state: 'adopted', adoptedAs: featurePath };
  const roadmapDirectory = posix.dirname(roadmap.path);
  const featureDirectory = posix.dirname(featurePath);
  const sourcePaths = repo.files(roadmapDirectory).sort();
  const observed = new Map<string, string>();
  for (const sourcePath of sourcePaths) {
    const source = repo.read(sourcePath);
    if (source === undefined) throw new ConcordError('PreimageChanged', `${sourcePath} disappeared during adoption`);
    observed.set(sourcePath, source);
  }
  if (observed.get(roadmap.path) === undefined || digest(observed.get(roadmap.path)!) !== roadmap.digest) throw new ConcordError('PreimageChanged', 'Roadmap owner changed during adoption planning');
  const supporting = sourcePaths.filter(path => path !== roadmap.path);
  for (const sourcePath of supporting) {
    if (!sourcePath.endsWith('.md')) throw new ConcordError('UnsupportedAttachment', `Roadmap adoption only copies Markdown pages: ${sourcePath}`);
    const source = observed.get(sourcePath)!;
    if (/^(?:\uFEFF)?---(?:\r?\n|$)/u.test(source)) throw new ConcordError('NestedOwner', `Roadmap adoption refuses nested owner-like Markdown: ${sourcePath}`);
    if (documents.some(document => document.path === sourcePath)) throw new ConcordError('NestedOwner', `Roadmap adoption refuses nested Concord owner: ${sourcePath}`);
    const destination = `${featureDirectory}/${sourcePath.slice(roadmapDirectory.length + 1)}`;
    if (repo.read(destination) !== undefined) throw new ConcordError('DocumentExists', `${destination} already exists`);
  }
  const featureBody = rebaseAdoptedMarkdown(roadmap.body, roadmap.path, featurePath, roadmapDirectory);
  const changes = [
    { path: featurePath, before: null, after: renderDocument(feature, featureBody) },
    { path: roadmap.path, before: observed.get(roadmap.path)!, after: renderDocument(adopted, roadmap.body) },
  ];
  for (const sourcePath of supporting) {
    const source = observed.get(sourcePath)!;
    const destination = `${featureDirectory}/${sourcePath.slice(roadmapDirectory.length + 1)}`;
    // Same-content source writes preserve the observed preimage in the journal.
    changes.push({ path: sourcePath, before: source, after: source });
    changes.push({ path: destination, before: null, after: rebaseAdoptedMarkdown(source, sourcePath, destination, roadmapDirectory) });
  }
  for (const record of documents) {
    if (record.metadata.kind !== 'memory') continue;
    const matching = record.metadata.promotions.filter(target => parseReference(target).path === roadmap.path);
    if (matching.length === 0) continue;
    const replacements = matching.map(target => `${featurePath}${target.slice(roadmap.path.length)}`);
    const retained = record.metadata.promotions.filter(target => !matching.includes(target));
    if (replacements.some(target => retained.includes(target))) throw new ConcordError('DuplicatePromotion', `Adoption would duplicate a promotion in ${record.path}`);
    const metadata: MemoryMeta = {
      ...record.metadata,
      promotions: [...retained, ...replacements],
      history: [...record.metadata.history, ...matching.map((target, index) => lifecycleHistory('adopt-roadmap', `Roadmap adopted as ${featurePath}`, at, `${target} -> ${replacements[index]}`))],
    };
    changes.push({ path: record.path, before: preimage(repo, record), after: renderDocument(metadata, record.body) });
  }
  // Recheck after the entire plan, including link transforms and promotions.
  const recaptured = repo.files(roadmapDirectory).sort();
  if (recaptured.length !== sourcePaths.length || recaptured.some((path, index) => path !== sourcePaths[index])) throw new ConcordError('PreimageChanged', 'Roadmap source collection changed during adoption planning');
  for (const sourcePath of sourcePaths) if (repo.read(sourcePath) !== observed.get(sourcePath)) throw new ConcordError('PreimageChanged', `${sourcePath} changed during adoption planning`);
  return repo.publish('adopt-roadmap', changes, dryRun);
}

// @concord-code record-memory-resolution
// @concord-implements docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md
export function resolveMemory(repo: Repository, selector: string, kind: Resolution['kind'], reason: string, proof?: FixedProof, dryRun = false): MutationReceipt {
  const record = findDocument(loadDocuments(repo), selector, 'memory'); const metadata = memory(record); const at = now();
  const why = required(reason, 'reason');
  let resolution: Resolution;
  if (kind === 'fixed') {
    if (proof === undefined || !proof.red || !proof.green || !proof.selectedCaseId || proof.epoch !== metadata.epoch) throw new ConcordError('InvalidProof', 'Fixed resolution requires verified red/green evidence for the current epoch');
    resolution = { kind, reason: why, at, epoch: metadata.epoch, evidenceLevel: 'command', red: proof.red, green: proof.green, selectedCaseId: proof.selectedCaseId };
  } else {
    if (proof !== undefined) throw new ConcordError('InvalidProof', 'Author resolutions do not accept command proof');
    if (!(['not-a-bug', 'wont-fix', 'external-fixed'] as const).includes(kind as never)) throw new ConcordError('InvalidInput', `Unknown resolution kind: ${kind}`);
    resolution = { kind, reason: why, at, epoch: metadata.epoch, evidenceLevel: 'author' };
  }
  return changed(repo, 'resolve-memory', record, resolvedMemory(metadata, resolution), record.body, dryRun);
}

export function reopenMemory(repo: Repository, selector: string, reason: string, dryRun = false): MutationReceipt {
  const record = findDocument(loadDocuments(repo), selector, 'memory');
  return changed(repo, 'reopen-memory', record, reopenedMemory(memory(record), reason, now()), record.body, dryRun);
}

export function supersedeMemory(repo: Repository, selector: string, replacement: string, reason: string, dryRun = false): MutationReceipt {
  const documents = loadDocuments(repo); const record = findDocument(documents, selector, 'memory'); const next = findDocument(documents, replacement, 'memory');
  let cursor = next; const seen = new Set<string>();
  while (cursor.metadata.kind === 'memory' && cursor.metadata.supersededBy !== undefined) {
    if (cursor.path === record.path || seen.has(cursor.path)) throw new ConcordError('ReferenceCycle', 'Memory supersession would create a cycle');
    seen.add(cursor.path); cursor = resolveReference(repo, documents, cursor.metadata.supersededBy, ['memory']);
  }
  return changed(repo, 'supersede-memory', record, supersededMemory(memory(record), memory(next), next.path, reason, now()), record.body, dryRun);
}

export function promoteMemory(repo: Repository, selector: string, target: string, dryRun = false): MutationReceipt {
  const documents = loadDocuments(repo); const record = findDocument(documents, selector, 'memory');
  const owner = resolveReference(repo, documents, target, CONTRACT_KINDS);
  if (owner.metadata.kind === 'roadmap' && owner.metadata.state !== 'planned') throw new ConcordError('InvalidRoadmapState', 'Only an unadopted Roadmap can receive a promotion');
  const canonical = parseReference(target).ref;
  return changed(repo, 'promote-memory', record, promotedMemory(memory(record), canonical), record.body, dryRun);
}

export function retirePromotion(repo: Repository, selector: string, target: string, reason: string, dryRun = false): MutationReceipt {
  const record = findDocument(loadDocuments(repo), selector, 'memory'); const canonical = parseReference(target).ref;
  return changed(repo, 'retire-promotion', record, retiredPromotion(memory(record), canonical, reason, now()), record.body, dryRun);
}

export function linkIssue(repo: Repository, selector: string, memoryRef: string, dryRun = false): MutationReceipt {
  const documents = loadDocuments(repo); const record = findDocument(documents, selector, 'issue');
  if (record.metadata.kind !== 'issue') throw new ConcordError('InvalidDocumentKind', selector);
  if (record.metadata.state !== 'draft') throw new ConcordError('InvalidIssueState', 'Closed Issue cannot gain links');
  const target = resolveReference(repo, documents, memoryRef, ['memory']); const canonical = target.path;
  if (record.metadata.memories.includes(canonical)) throw new ConcordError('DuplicateLink', `${canonical} is already linked`);
  return changed(repo, 'link-issue', record, { ...record.metadata, memories: [...record.metadata.memories, canonical] }, record.body, dryRun);
}

// @concord-code link-feedback-feature
// @concord-implements docs/feature/feedback/use-case/triage-feedback.md
export function linkFeedbackFeature(repo: Repository, selector: string, featureRef: string, dryRun = false): MutationReceipt {
  const documents = loadDocuments(repo); const record = findDocument(documents, selector, 'issue');
  if (record.metadata.kind !== 'issue') throw new ConcordError('InvalidDocumentKind', selector);
  if (record.metadata.state !== 'draft') throw new ConcordError('InvalidIssueState', 'Closed feedback cannot gain links');
  const target = findDocument(documents, featureRef, 'feature'); const canonical = target.path;
  const features = record.metadata.features ?? [];
  if (features.includes(canonical)) throw new ConcordError('DuplicateLink', `${canonical} is already linked`);
  return changed(repo, 'link-feedback', record, { ...record.metadata, features: [...features, canonical] }, record.body, dryRun);
}

export function closeIssue(repo: Repository, selector: string, reason: string, dryRun = false): MutationReceipt {
  const documents = loadDocuments(repo); const record = findDocument(documents, selector, 'issue');
  if (record.metadata.kind !== 'issue') throw new ConcordError('InvalidDocumentKind', selector);
  if (record.metadata.state !== 'draft') throw new ConcordError('InvalidIssueState', 'Issue is already closed');
  for (const ref of record.metadata.memories) {
    const target = resolveReference(repo, documents, ref, ['memory']);
    if (target.metadata.kind === 'memory' && target.metadata.memoryKind === 'problem' && target.metadata.state === 'open') throw new ConcordError('OpenProblem', `Resolve linked Problem ${ref} before closing the Issue`);
  }
  const at = now(); const why = required(reason, 'reason');
  return changed(repo, 'close-issue', record, { ...record.metadata, state: 'closed', history: [...record.metadata.history, lifecycleHistory('close', why, at)] }, record.body, dryRun);
}
