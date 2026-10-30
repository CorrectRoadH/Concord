import { readDesignPlanPaths } from "../../base/sources/index.js";
import { posix } from "node:path";
import { Schema } from "effect";
import { deriveDesignRecord } from "../designs/index.js";
import { writeDesignDeclaration } from "../../model/index.js";
import { fromMarkdown } from "../../model/index.js";

import { decodeDocumentSource as parseDocumentSource } from "./document-codec.js";
import { renderDocument } from "../../model/index.js";

import { ConcordError, IssueClosureSchema, MEMORY_RELATION_KINDS, type IssueClosure, type IssueRelation, DocumentName, Text, decode, digest, inRepositorySnapshot, type DocumentKind, type DocumentMeta, type DocumentRecord, type Finding, type MemoryMeta, type MutationReceipt, type Repository } from "../../model/index.js";
import { supersededMemory } from "../../model/index.js";
import { parseReference, resolveReference } from "./refs.js";
import { CONSTITUTION_PATH, clauseIndex, showConstitution } from "../constitution/index.js";
import { templateBody } from "./templates.js";
import { TEMPLATE_PAGES } from "../../model/index.js";
import { rebaseAdoptedMarkdown } from "./adoption.js";
import { inspectDocumentProjections, projectionRecord } from "./document-projection.js";
import { designContentPaths, formatDesignMarkdown, validateDesignContent } from "../designs/index.js";

import { DOCUMENT_ROOTS, defaultDocumentPath, documentDisposition, documentPlacementError, matchingOwners } from "../../model/index.js";


// @concord-code
// @concord-implements docs/feature/local-sdlc/architecture.md#操作依赖
export function documentRoots(repo: Repository): readonly string[] {
  return inRepositorySnapshot(repo, () => { return [...DOCUMENT_ROOTS, ...['memory']];   });
}
const CONTRACT_KINDS: readonly DocumentKind[] = ['feature', 'use-case', 'engineering'];
const now = (): string => new Date().toISOString();

// @concord-begin
// @concord-implements docs/feature/local-sdlc/architecture.md#编译管线
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
  return parseDocumentSource(path, source);
}

export function inspectDocumentRecords(inputs: readonly { readonly path: string; readonly source: string }[], markdown = false) {
  return inspectDocumentProjections(inputs, markdown).map((result, index) => {
    if (!result.ok) return result;
    // Always apply location rules, including on an in-memory projection hit.
    try { return { ok: true as const, value: projectionRecord(inputs[index]!.path, result.value) }; }
    catch (cause) { return { ok: false as const, cause }; }
  });
}

// @concord-end

// @concord-begin
// @concord-implements docs/feature/local-sdlc/architecture.md#写入管线
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
// @concord-end

// @concord-begin
// @concord-implements docs/feature/local-sdlc/architecture.md#操作依赖
// @concord-implements docs/feature/document-packages/use-case/discover-managed-documents.md
export function loadDocuments(repo: Repository, kinds?: readonly DocumentKind[]): DocumentRecord[] {
  return inRepositorySnapshot(repo, () => loadDocumentsUnderSnapshot(repo, kinds));
}
function documentInputs(repo: Repository, kinds?: readonly DocumentKind[], findings?: Finding[]): { path: string; source: string }[] {
  const paths = new Set<string>();
  const roots = kinds === undefined ? documentRoots(repo) : [...new Set(kinds.flatMap(kind => kind === 'memory'
    ? ['memory']
    : [kind === 'use-case' ? 'docs/feature' : kind === 'issue' ? 'docs/issues' : `docs/${kind}`]))];
  for (const root of roots) {
    for (const path of repo.files(root)) if (path.endsWith('.md')) paths.add(path);
  }
  const inputs: { path: string; source: string }[] = [];
  for (const path of [...paths].sort()) {
    const source = repo.read(path);
    if (source === undefined) continue;
    inputs.push({ path, source });
  }
  return inputs;
}

function currentDocument(repo: Repository, record: DocumentRecord | undefined): record is DocumentRecord {
  return record !== undefined && documentDisposition(record.metadata.kind, record.path, ['memory']) === 'current';
}

function loadDocumentsUnderSnapshot(repo: Repository, kinds?: readonly DocumentKind[]): DocumentRecord[] {
  return inspectDocumentRecords(documentInputs(repo, kinds)).map(result => { if (!result.ok) throw result.cause; return result.value; })
    .filter((record): record is DocumentRecord => currentDocument(repo, record) && (kinds === undefined || kinds.includes(record.metadata.kind)))
    .map(record => deriveDesignRecord(repo, record));
}
// @concord-end

export interface DocumentInventory {
  readonly documents: readonly DocumentRecord[];
  readonly findings: readonly Finding[];
  readonly complete: boolean;
}

/** Diagnostic records and completeness travel together across projection boundaries. */
// @concord-code
// @concord-implements docs/feature/local-sdlc/architecture.md#完整性诊断
// @concord-implements docs/feature/document-packages/use-case/discover-managed-documents.md
export function diagnoseDocuments(repo: Repository): DocumentInventory {
  return inRepositorySnapshot(repo, () => {
    const documents: DocumentRecord[] = [], findings: Finding[] = [];
    const inputs = documentInputs(repo, undefined, findings);
    const results = inspectDocumentRecords(inputs, true);
    for (const [index, input] of inputs.entries()) {
      try {
        const result = results[index]!;
        if (!result.ok) throw result.cause;
        const record = result.value;
        if (currentDocument(repo, record)) documents.push(deriveDesignRecord(repo, record));
      } catch (cause) {
        if (!(cause instanceof ConcordError) || !['InvalidData', 'InvalidPlacement', 'InvalidPlan', 'DesignPlanNotFound', 'AmbiguousDesignPlan', 'DesignSelectionInvalid', 'DesignSelectionConflict'].includes(cause.code)) throw cause;
        findings.push({ code: cause.code, path: input.path, message: cause.message });
      }
    }
    return { documents, findings, complete: findings.length === 0 };
  });
}

/** Read only a canonical target and its physical owner boundary, never an unrelated inventory. */
// @concord-begin
// @concord-implements docs/feature/local-sdlc/architecture.md#操作依赖
export function readDocumentReference(repo: Repository, reference: string, kinds?: readonly DocumentKind[]): DocumentRecord {
  return inRepositorySnapshot(repo, () => {
    const parsed = parseReference(reference);
    const roots = documentRoots(repo);
    if (!roots.some(root => parsed.path.startsWith(`${root}/`))) throw new ConcordError('ReferenceNotFound', `Reference is outside document sources: ${reference}`);
    const records: DocumentRecord[] = [];
    const read = (path: string): DocumentRecord | undefined => {
      const source = repo.read(path);
      const record = source === undefined ? undefined : parseDocumentRecord(path, source);
      if (record !== undefined && !currentDocument(repo, record)) throw new ConcordError('InvalidReferenceTarget', `${path} is not a current owner`);
      return record === undefined ? undefined : deriveDesignRecord(repo, record);
    };
    let owner = read(parsed.path);
    if (owner === undefined) {
      for (let directory = posix.dirname(parsed.path); roots.some(root => directory.startsWith(`${root}/`)); directory = posix.dirname(directory)) {
        const candidate = `${directory}/README.md`;
        if (candidate === parsed.path) continue;
        owner = read(candidate);
        if (owner !== undefined) break;
      }
    }
    if (owner !== undefined) {
      if (kinds !== undefined && !kinds.includes(owner.metadata.kind)) throw new ConcordError('InvalidReferenceTarget', `${reference} resolves to ${owner.metadata.kind}; expected ${kinds.join(', ')}`);
      records.push(owner);
      let featurePath: string | undefined;
      if (owner.metadata.kind === 'use-case') {
        const feature = readDocumentReference(repo, owner.metadata.feature, ['feature']);
        if (feature.path !== owner.metadata.feature) throw new ConcordError('InvalidPlacement', 'Use Case requires an exact Feature owner');
        featurePath = feature.path;
      }
      const placement = documentPlacementError(owner.metadata.kind, owner.path, featurePath);
      if (placement !== undefined) throw new ConcordError('InvalidPlacement', placement);
    }
    return resolveReference(repo, records, reference, kinds);
  });
}

export function readDocumentSelector(repo: Repository, selector: string, kind: DocumentKind): DocumentRecord {
  if (!selector.includes('/')) return findDocument(loadDocuments(repo, [kind]), selector, kind);
  const parsed = parseReference(selector);
  if (parsed.anchor !== undefined) throw new ConcordError('InvalidReference', 'Document selectors cannot contain anchors');
  const record = readDocumentReference(repo, selector, [kind]);
  if (record.path !== parsed.path) throw new ConcordError('InvalidReferenceTarget', 'Expected an exact document owner');
  return record;
}

export function findDocument(documents: readonly DocumentRecord[], selector: string, kind?: DocumentKind): DocumentRecord {
  required(selector, 'selector');
  if (selector.includes('/')) {
    const parsed = parseReference(selector);
    if (parsed.anchor !== undefined) throw new ConcordError('InvalidReference', 'Document selectors cannot contain anchors');
  } else decode(DocumentName, selector, 'selector');
  const byId = matchingOwners(documents, selector, kind);
  if (byId.length === 0) throw new ConcordError('DocumentNotFound', `No${kind === undefined ? '' : ` ${kind}`} document matches ${selector}`);
  if (byId.length > 1) throw new ConcordError('AmbiguousDocument', `Document id ${selector} is ambiguous; use its canonical path`);
  return byId[0]!;
}
// @concord-end



// @concord-begin
// @concord-implements docs/feature/local-sdlc/use-case/review-traceability.md#check
function finding(findings: Finding[], code: string, path: string, message: string): void {
  findings.push({ code, path, message });
}

/** A Decision may be promoted to the constitution or one of its clauses and paragraphs. */
function constitutionPromotion(repo: Repository, target: string): string | undefined {
  const parsed = parseReference(target);
  if (parsed.path !== CONSTITUTION_PATH) return undefined;
  if (parsed.anchor !== undefined && !clauseIndex(showConstitution(repo).clauses).has(parsed.anchor)) throw new ConcordError('AnchorNotFound', `Constitution clause ${parsed.anchor} does not exist`);
  return parsed.ref;
}

function checkRef(
  findings: Finding[], repo: Repository, documents: readonly DocumentRecord[], owner: DocumentRecord,
  ref: string, kinds: readonly DocumentKind[], label: string,
): DocumentRecord | undefined {
  try { return resolveReference(repo, documents, ref, kinds); }
  catch (cause) { finding(findings, cause instanceof ConcordError ? cause.code : 'InvalidReference', owner.path, `${label}: ${cause instanceof Error ? cause.message : String(cause)}`); return undefined; }
}

function checkIssueClosure(repo: Repository, documents: readonly DocumentRecord[], document: DocumentRecord): Finding[] {
  const findings: Finding[] = []; const metadata = document.metadata;
  if (metadata.kind !== 'issue') return findings;
  if (metadata.closure?.kind === 'fixed' && metadata.closure.verification === undefined) finding(findings, 'FixUnverifiable', document.path, 'Fixed closure requires verification');
  if (metadata.closure?.kind === 'declined') {
    const closureMemory = checkRef(findings, repo, documents, document, metadata.closure.memory, ['memory'], 'closure Memory');
    if (closureMemory?.metadata.kind === 'memory') {
      const m = closureMemory.metadata;
      if (metadata.closure.kind === 'declined' && (m.type !== 'decision' || m.status !== 'current')) finding(findings, 'InvalidState', document.path, 'Declined closure requires a current Decision');
    }
  }
  if (metadata.closure?.kind === 'delivered') {
    const closureMemory = checkRef(findings, repo, documents, document, metadata.closure.memory, ['memory'], 'closure Memory');
    if (closureMemory?.metadata.kind === 'memory' && !(closureMemory.metadata.type === 'decision' && closureMemory.metadata.status === 'current')) finding(findings, 'InvalidState', document.path, 'Delivery requires a current Decision');
    checkRef(findings, repo, documents, document, metadata.closure.target, CONTRACT_KINDS, 'closure target');
    if (!metadata.relations.some(relation => relation.role === 'adopts' && metadata.closure?.kind === 'delivered' && relation.target === metadata.closure.target)) finding(findings, 'InvalidState', document.path, 'Delivered target must be a current adopts relation');
  }
  if (metadata.closure?.kind === 'duplicate') checkRef(findings, repo, documents, document, metadata.closure.canonical, ['issue'], 'canonical Issue');
  if (metadata.closure !== undefined && ['duplicate', 'declined', 'invalid'].includes(metadata.closure.kind) && metadata.relations.some(relation => relation.role === 'adopts')) finding(findings, 'InvalidState', document.path, 'This closure requires current adoptions to be retired explicitly');
  const seen = new Set<string>(); let cursor: DocumentRecord | undefined = document;
  while (cursor?.metadata.kind === 'issue' && cursor.metadata.closure?.kind === 'duplicate') {
    if (seen.has(cursor.path)) { finding(findings, 'ReferenceCycle', document.path, 'Issue duplicate closure contains a cycle'); break; }
    seen.add(cursor.path);
    try { cursor = resolveReference(repo, documents, cursor.metadata.closure.canonical, ['issue']); } catch { break; }
  }
  return findings;
}

export function checkDocuments(repo: Repository, documents: readonly DocumentRecord[]): Finding[] {
  return inRepositorySnapshot(repo, () => {
  const findings: Finding[] = [];
  const identities = new Map<string, DocumentRecord[]>();
  for (const document of documents) {
    const key = document.path;
    identities.set(key, [...(identities.get(key) ?? []), document]);
    let featurePath: string | undefined;
    if (document.metadata.kind === 'use-case') {
      try { featurePath = findDocument(documents, document.metadata.feature, 'feature').path; } catch { /* Report placement and relation below. */ }
    }
    const placement = documentPlacementError(document.metadata.kind, document.path, featurePath);
    if (placement !== undefined) finding(findings, 'InvalidPlacement', document.path, placement);

    const metadata = document.metadata;
    if (metadata.kind === 'use-case') checkRef(findings, repo, documents, document, metadata.feature, ['feature'], 'feature');
    if (metadata.kind === 'design') {
      try { repo.files(`${posix.dirname(document.path)}/plans`); readDesignPlanPaths(repo.root, posix.dirname(document.path), metadata.alternatives); }
      catch (cause) { finding(findings, cause instanceof ConcordError ? cause.code : 'InvalidPlan', document.path, String(cause)); }
      if (metadata.decision !== undefined && metadata.deferral !== undefined) finding(findings, 'InvalidState', document.path, 'Design cannot be selected and deferred at the same time');
      if (new Set(metadata.alternatives).size !== metadata.alternatives.length) finding(findings, 'InvalidState', document.path, 'Design alternatives must be unique');
      if (metadata.decision !== undefined) {
        if (!metadata.alternatives.includes(metadata.decision.selected)) finding(findings, 'InvalidState', document.path, 'Selected alternative is not declared');
        if (new Set(metadata.decision.targets).size !== metadata.decision.targets.length) finding(findings, 'InvalidState', document.path, 'Design decision targets must be unique');
        for (const target of metadata.decision.targets) checkRef(findings, repo, documents, document, target, CONTRACT_KINDS, 'decision target');
        findings.push(...validateDesignContent(posix.dirname(document.path), metadata.alternatives, designSnapshot(repo, document), metadata.decision.selected).findings);
      }
    }
    if (metadata.kind === 'roadmap') {
      if (metadata.state !== 'adopted' && metadata.adoptedAs !== undefined) finding(findings, 'InvalidState', document.path, 'Only an adopted Roadmap can have adoptedAs');
      if (metadata.state === 'cancelled' && metadata.cancellation === undefined) finding(findings, 'InvalidState', document.path, 'Cancelled Roadmap must retain its cancellation reason and source');
      if (metadata.state !== 'cancelled' && metadata.cancellation !== undefined) finding(findings, 'InvalidState', document.path, 'Only a cancelled Roadmap can have cancellation');
      if (metadata.state === 'adopted' && metadata.adoptedAs === undefined) finding(findings, 'InvalidState', document.path, 'Adopted Roadmap must identify its Feature');
      if (metadata.adoptedAs !== undefined) checkRef(findings, repo, documents, document, metadata.adoptedAs, ['feature'], 'adoptedAs');
    }
    if (metadata.kind === 'memory') {
      if (metadata.type === 'note' && metadata.status !== 'captured') finding(findings, 'InvalidState', document.path, 'Note Memory must remain captured');
      if (metadata.status !== 'superseded' && (metadata.supersededBy !== undefined || metadata.supersession !== undefined)) finding(findings, 'InvalidState', document.path, 'Only superseded Memory may declare supersession');
      if (metadata.status === 'superseded' && metadata.supersededBy === undefined && metadata.supersession === undefined) finding(findings, 'InvalidState', document.path, 'Superseded Memory requires a replacement or supersession source');
      for (const relation of metadata.relations) {
        if (relation.role === 'amends') {
          if (metadata.type !== 'decision') finding(findings, 'InvalidState', document.path, 'Only a Decision can amend the constitution');
          if (!/^docs\/constitution\.md(?:#c-(?!000)\d{3}(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?)?$/u.test(relation.target)) finding(findings, 'InvalidReference', document.path, 'amends requires a constitution ID');
        } else checkRef(findings, repo, documents, document, relation.target, CONTRACT_KINDS, 'supports');
      }
      if (metadata.supersededBy !== undefined) {
        const replacement = checkRef(findings, repo, documents, document, metadata.supersededBy, ['memory'], 'supersededBy');
        if (replacement?.metadata.kind === 'memory' && replacement.metadata.type !== metadata.type) finding(findings, 'InvalidState', document.path, 'Replacement Memory must have the same type');
      }
    }
    if (metadata.kind === 'issue') {
      if (metadata.status === 'closed' && metadata.closure === undefined) finding(findings, 'InvalidState', document.path, 'Closed Issue must declare closure');
      if (metadata.status === 'open' && metadata.closure !== undefined) finding(findings, 'InvalidState', document.path, 'Open Issue cannot declare closure');
      findings.push(...checkIssueClosure(repo, documents, document));
      for (const relation of metadata.relations) {
        const linked = checkRef(findings, repo, documents, document, relation.target, relation.role === 'related' ? ['issue'] : relation.role === 'adopts' ? CONTRACT_KINDS : ['memory'], `relation (${relation.role})`);
        if (linked?.metadata.kind === 'memory' && !['current', 'superseded'].includes(linked.metadata.status)) finding(findings, 'InvalidState', document.path, `${relation.role} requires current or superseded Memory`);
        if (relation.role === 'related' && linked?.path === document.path) finding(findings, 'InvalidState', document.path, 'related requires another Issue');
      }
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
  });
}
// @concord-end

export interface CreateDocumentInput {
  readonly id: string;
  readonly title: string;
  readonly body?: string;
  readonly feature?: string;
  readonly observedAt?: string;
  readonly sources?: readonly string[];
  readonly alternatives?: readonly string[];
  readonly pages?: readonly string[];
  readonly memoryKind?: 'decision' | 'insight' | 'note';
  readonly dryRun?: boolean;
}

// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md#create
// @concord-implements docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md#roadmap
// @concord-implements docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md#add
// @concord-implements docs/feature/document-packages/use-case/organize-freeform-research.md
export function createDocument(repo: Repository, kind: DocumentKind, input: CreateDocumentInput): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
  const id = decode(DocumentName, input.id, 'id');
  if (['use-case', 'issue', 'memory'].includes(kind) && id.toLowerCase() === 'readme') throw new ConcordError('InvalidInput', 'README is reserved for navigation');
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
  const documents = kind === 'memory' ? [] : loadDocuments(repo, kind === 'issue' ? ['issue'] : undefined);
  if (kind !== 'memory' && kind !== 'use-case' && documents.some(document => document.metadata.kind === kind && document.metadata.id === id)) {
    throw new ConcordError('DocumentExists', `${kind} id ${id} already exists; use its canonical path`);
  }
  let path: string;
  let metadata: DocumentMeta;
  let template: string = kind;
  switch (kind) {
    case 'feature': path = defaultDocumentPath(kind, id); metadata = { format: 'concord.document/v1', id, title, kind }; break;
    case 'use-case': {
      const feature = findDocument(documents, required(input.feature, 'feature'), 'feature');
      const placement = documentPlacementError('feature', feature.path);
      if (placement !== undefined) throw new ConcordError('InvalidPlacement', placement);
      path = defaultDocumentPath(kind, id, feature.path);
      metadata = { format: 'concord.document/v1', id, title, kind, feature: feature.path };
      break;
    }
    case 'roadmap': path = defaultDocumentPath(kind, id); metadata = { format: 'concord.document/v1', id, title, createdAt, kind, state: 'planned' }; break;
    case 'design': {
      const alternatives = input.alternatives?.map(value => decode(DocumentName, value, 'alternative')) ?? [];
      if (alternatives.length === 0 || alternatives.some(name => name.toLowerCase() === 'readme') || new Set(alternatives).size !== alternatives.length) throw new ConcordError('InvalidInput', 'Design requires unique non-empty alternatives');
      path = defaultDocumentPath(kind, id); metadata = { format: 'concord.document/v1', id, title, createdAt, kind, alternatives: alternatives as [string, ...string[]] };
      break;
    }
    case 'engineering': path = defaultDocumentPath(kind, id); metadata = { format: 'concord.document/v1', id, title, kind }; break;
    case 'research': path = defaultDocumentPath(kind, id); metadata = { format: 'concord.document/v1', id, title, createdAt, kind, ...(input.observedAt === undefined ? {} : { observedAt: required(input.observedAt, 'observedAt') }), sources: input.sources ?? [] }; break;
    case 'memory': {
      const memoryKind = input.memoryKind;
      if (memoryKind === undefined) throw new ConcordError('InvalidInput', 'memoryKind is required');
      path = `memory/${id}.md`;
      template = memoryKind;
      metadata = { format: 'concord.document/v1', id, title, createdAt, kind, type: memoryKind, status: 'captured', relations: [] };
      break;
    }
    case 'issue': path = defaultDocumentPath(kind, id); metadata = { format: 'concord.document/v1', id, title, createdAt, kind, status: 'open', relations: [] }; break;
  }
  const body = kind === 'research' && input.body === undefined ? `# ${title}\n` : bodyFor(template);
  if (kind === 'research' && repo.files(posix.dirname(path)).length > 0) throw new ConcordError('DocumentExists', `${posix.dirname(path)} already contains files; creating an owner would change their ownership`);
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
      add(`${base}/README.md`, 'design-plan');
      for (const page of requested) add(`${base}/${page === 'use-case' ? 'use-case/README.md' : `${page}.md`}`, page === 'use-case' ? 'use-case-index' : page);
    }
  }
  for (const change of changes) if (repo.read(change.path) !== undefined) throw new ConcordError('DocumentExists', `${change.path} already exists`);
  return repo.publish(`create-${kind}`, changes, input.dryRun ?? false);
  });
}



// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md#edit
// @concord-implements docs/feature/web-workbench/README.md#文档阅读与编辑
export function setAuthor(repo: Repository, ref: string, body: string, expectedDigest: string, dryRun = false): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
  const record = readDocumentReference(repo, ref);
  if (record.path !== parseReference(ref).path) throw new ConcordError('InvalidReferenceTarget', 'Author body belongs to an exact Concord owner, not supporting Markdown');
  if (record.digest !== expectedDigest) throw new ConcordError('PreimageChanged', `${record.path} changed; use its current digest`);
  return changed(repo, 'set-author', record, record.metadata, authorBody(body), dryRun);
  });
}

/** Updates only explicit author-owned metadata; lifecycle and identity remain domain operations. */
// @concord-begin
// @concord-implements docs/feature/local-sdlc/use-case/compare-design-plans.md
export function decideDesign(repo: Repository, selector: string, selected: string, targets: readonly string[], reason: string, dryRun = false): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
  const documents = loadDocuments(repo); const record = findDocument(documents, selector, 'design');
  if (record.metadata.kind !== 'design') throw new ConcordError('InvalidDocumentKind', selector);
  if (record.metadata.decision !== undefined) throw new ConcordError('DecisionExists', 'A Design decision cannot be overwritten');
  const choice = decode(DocumentName, selected, 'selected');
  if (!record.metadata.alternatives.includes(choice)) throw new ConcordError('InvalidDecision', `${choice} is not a declared alternative`);
  const uniqueTargets = [...new Set(targets)];
  if (uniqueTargets.length !== targets.length) throw new ConcordError('InvalidDecision', 'Decision targets must be unique');
  for (const target of targets) resolveReference(repo, documents, target, CONTRACT_KINDS);
  const snapshot = designSnapshot(repo, record);
  const decisionPath = `${posix.dirname(record.path)}/DECISION.md`;
  const entries = readDesignPlanPaths(repo.root, posix.dirname(record.path), record.metadata.alternatives);
  const decisionSource = snapshot.get(decisionPath);
  if (decisionSource === undefined) throw new ConcordError('DesignDecisionIncomplete', `${decisionPath} is missing`);
  const next = writeDesignDeclaration(decisionSource, `Selected: [${choice}](${posix.relative(posix.dirname(record.path), entries.get(choice)!)})`, required(reason, 'reason'));
  const candidate = new Map(snapshot).set(decisionPath, next);
  const assessment = validateDesignContent(posix.dirname(record.path), record.metadata.alternatives, candidate, choice);
  if (assessment.findings.length) throw new ConcordError('DesignDecisionIncomplete', assessment.findings.map(item => `${item.code}: ${item.path}: ${item.message}`).join('\n'));
  return repo.publish('decide-design', [...snapshot].flatMap(([path, source]) => source === undefined ? [] : [{ path, before: source, after: path === decisionPath ? next : source }]), dryRun);
  });
}

export function deferDesign(repo: Repository, selector: string, reason: string, dryRun = false): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
    const record = readDocumentSelector(repo, selector, 'design');
    if (record.metadata.kind !== 'design') throw new ConcordError('InvalidDocumentKind', selector);
    if (record.metadata.decision !== undefined) throw new ConcordError('DecisionExists', 'A Design decision cannot be overwritten');
    const path = `${posix.dirname(record.path)}/DECISION.md`;
    const before = repo.read(path);
    if (before === undefined) throw new ConcordError('DesignDecisionIncomplete', `${path} is missing`);
    return repo.publish('defer-design', [{ path, before, after: writeDesignDeclaration(before, `Deferred: ${required(reason, 'reason')}`) }], dryRun);
  });
}

function designSnapshot(repo: Repository, record: DocumentRecord): Map<string, string | undefined> {
  if (record.metadata.kind !== 'design') throw new ConcordError('InvalidDocumentKind', record.path);
  const base = posix.dirname(record.path);
  const supporting = repo.files(base).filter(path => path.endsWith('.md'));
  readDesignPlanPaths(repo.root, base, record.metadata.alternatives);
  const paths = [...new Set([...designContentPaths(base, record.metadata.alternatives), ...supporting])];
  const snapshot = new Map(paths.map(path => [path, path === record.path ? preimage(repo, record) : repo.read(path)]));
  return snapshot;
}

export function checkDesign(repo: Repository, selector: string) {
  return inRepositorySnapshot(repo, () => {
  const record = findDocument(loadDocuments(repo), selector, 'design');
  if (record.metadata.kind !== 'design') throw new ConcordError('InvalidDocumentKind', record.path);
  const snapshot = designSnapshot(repo, record);
  const result = validateDesignContent(posix.dirname(record.path), record.metadata.alternatives, snapshot, record.metadata.decision?.selected);
  for (const [path, source] of snapshot) if (repo.read(path) !== source) throw new ConcordError('PreimageChanged', `${path} changed while checking Design`);
  return { operation: 'design-check', path: record.path, ok: result.findings.length === 0, ...result };
  });
}

export function formatDesign(repo: Repository, selector: string, dryRun = false): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
  const record = findDocument(loadDocuments(repo), selector, 'design');
  const snapshot = designSnapshot(repo, record);
  const changes = [...snapshot].flatMap(([path, source]) => {
    if (source === undefined || record.metadata.kind !== 'design' || !designContentPaths(posix.dirname(record.path), record.metadata.alternatives).includes(path)) return [];
    const next = path === record.path ? source : formatDesignMarkdown(source);
    return next === source ? [] : [{ path, before: source, after: next }];
  });
  if (changes.length === 0) return { operation: 'format-design', dryRun, changedPaths: [] };
  changes.unshift({ path: record.path, before: snapshot.get(record.path)!, after: snapshot.get(record.path)! });
  return repo.publish('format-design', changes, dryRun);
  });
}
// @concord-end

// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md#adopt
export function adoptRoadmap(repo: Repository, selector: string, featureId: string, dryRun = false): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
  const documents = loadDocuments(repo); const roadmap = findDocument(documents, selector, 'roadmap');
  if (roadmap.metadata.kind !== 'roadmap') throw new ConcordError('InvalidDocumentKind', selector);
  if (roadmap.metadata.state !== 'planned') throw new ConcordError('InvalidRoadmapState', 'Only a planned Roadmap can be adopted');
  const id = decode(DocumentName, featureId, 'featureId'); const featurePath = defaultDocumentPath('feature', id);
  if (documents.some(document => document.metadata.kind === 'feature' && document.metadata.id === id)) throw new ConcordError('DocumentExists', `Feature id ${id} already exists`);
  if (repo.read(featurePath) !== undefined) throw new ConcordError('DocumentExists', `${featurePath} already exists`);
  const roadmapDirectory = posix.dirname(roadmap.path);
  const featureDirectory = posix.dirname(featurePath);
  if (repo.files(featureDirectory).length > 0 || (repo.exists?.(featureDirectory) ?? false)) throw new ConcordError('DocumentExists', `${featureDirectory} already exists`);
  const sourcePaths = repo.files(roadmapDirectory).sort();
  const observed = new Map<string, string>();
  const changes: import("../../model/shared.js").Change[] = [];
  for (const sourcePath of sourcePaths) {
    if (!sourcePath.endsWith('.md')) throw new ConcordError('UnsupportedAttachment', `Roadmap adoption only moves Markdown pages: ${sourcePath}`);
    const source = repo.read(sourcePath);
    if (source === undefined) throw new ConcordError('PreimageChanged', `${sourcePath} disappeared during adoption`);
    observed.set(sourcePath, source);
    if (sourcePath !== roadmap.path && (/^(?:\uFEFF)?---(?:\r?\n|$)/u.test(source) || documents.some(document => document.path === sourcePath))) throw new ConcordError('NestedOwner', `Roadmap adoption refuses nested owners: ${sourcePath}`);
    const destination = `${featureDirectory}/${sourcePath.slice(roadmapDirectory.length + 1)}`;
    if (repo.read(destination) !== undefined) throw new ConcordError('DocumentExists', destination);
    changes.push({ path: sourcePath, before: source, after: null }, { path: destination, before: null, after: rebaseAdoptedMarkdown(source, sourcePath, destination, roadmapDirectory) });
  }
  if (observed.get(roadmap.path) === undefined || digest(observed.get(roadmap.path)!) !== roadmap.digest) throw new ConcordError('PreimageChanged', 'Roadmap owner changed during adoption planning');
  const mapReference = (target: string): string => target === roadmapDirectory || target.startsWith(`${roadmapDirectory}/`) ? `${featureDirectory}${target.slice(roadmapDirectory.length)}` : target;
  const byPath = new Map(documents.map(record => [record.path, record]));
  const markdown = new Set([...repo.files('docs'), ...repo.files('memory')].filter(path => path.endsWith('.md') && !observed.has(path)));
  for (const path of markdown) {
    const before = repo.read(path);
    if (before === undefined) continue;
    const record = byPath.get(path);
    let source = before;
    if (record?.metadata.kind === 'memory' || record?.metadata.kind === 'issue') {
      const relations = record.metadata.relations.map(relation => ({ ...relation, target: mapReference(relation.target) }));
      if (JSON.stringify(relations) !== JSON.stringify(record.metadata.relations)) source = renderDocument({ ...record.metadata, relations } as DocumentMeta, record.body);
      if (record.metadata.kind === 'issue' && record.metadata.closure?.kind === 'delivered') {
        const closure = { ...record.metadata.closure, target: mapReference(record.metadata.closure.target) };
        if (closure.target !== record.metadata.closure.target) source = renderDocument({ ...record.metadata, relations: relations as import("../../model/shared.js").IssueMeta['relations'], closure }, record.body);
      }
    }
    // Only documents with an inbound Markdown link need the bounded link transform.
    const links: { url: string }[] = [];
    const visit = (node: import('mdast').Nodes): void => {
      if (node.type === 'link' || node.type === 'image' || node.type === 'definition') links.push({ url: node.url });
      if ('children' in node) node.children.forEach(visit);
    };
    visit(fromMarkdown(source.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, '')));
    const inbound = links.some(link => !/^(?:[A-Za-z][A-Za-z0-9+.-]*:|[/#])/u.test(link.url) && mapReference(posix.normalize(posix.join(posix.dirname(path), link.url.split('#')[0]!))) !== posix.normalize(posix.join(posix.dirname(path), link.url.split('#')[0]!)));
    if (inbound) source = rebaseAdoptedMarkdown(source, path, path, roadmapDirectory, featureDirectory);
    if (source !== before) changes.push({ path, before, after: source });
  }
  // Recheck after the entire plan, including link transforms and promotions.
  const recaptured = repo.files(roadmapDirectory).sort();
  if (recaptured.length !== sourcePaths.length || recaptured.some((path, index) => path !== sourcePaths[index])) throw new ConcordError('PreimageChanged', 'Roadmap source collection changed during adoption planning');
  for (const sourcePath of sourcePaths) if (repo.read(sourcePath) !== observed.get(sourcePath)) throw new ConcordError('PreimageChanged', `${sourcePath} changed during adoption planning`);
  return repo.publish('adopt-roadmap', changes, dryRun);
  });
}


// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md#lifecycle
export function activateMemory(repo: Repository, selector: string, reason: string, dryRun = false): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
  const record = readDocumentSelector(repo, selector, 'memory');
  const metadata = memory(record);
  if (metadata.status !== 'captured') throw new ConcordError('InvalidMemoryState', 'Only captured Memory can be activated');
  if (metadata.type === 'note') throw new ConcordError('InvalidMemoryState', 'A note cannot be activated without explicit classification');
  const at = now();
  required(reason, 'reason');
  return changed(repo, 'activate-memory', record, { ...metadata, status: 'current' }, record.body, dryRun);
  });
}


// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md#lifecycle
export function supersedeMemory(repo: Repository, selector: string, replacement: string, reason: string, dryRun = false): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
  const documents = loadDocuments(repo); const record = findDocument(documents, selector, 'memory'); const next = findDocument(documents, replacement, 'memory');
  let cursor = next; const seen = new Set<string>();
  while (cursor.metadata.kind === 'memory' && cursor.metadata.supersededBy !== undefined) {
    if (cursor.path === record.path || seen.has(cursor.path)) throw new ConcordError('ReferenceCycle', 'Memory supersession would create a cycle');
    seen.add(cursor.path); cursor = resolveReference(repo, documents, cursor.metadata.supersededBy, ['memory']);
  }
  return changed(repo, 'supersede-memory', record, supersededMemory(memory(record), memory(next), next.path, reason, now()), record.body, dryRun);
  });
}


/** Lifecycle-independent relation helper used by the current Memory command surface. */
export function linkMemory(repo: Repository, selector: string, target: string, role: 'supports' | 'amends' = 'supports', dryRun = false): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
    const record = readDocumentSelector(repo, selector, 'memory');
    const metadata = memory(record);
    const canonical = parseReference(target).ref;
    if (role === 'amends') {
      if (constitutionPromotion(repo, canonical) === undefined) throw new ConcordError('InvalidReferenceTarget', 'amends requires the constitution or one of its clauses');
    } else readDocumentReference(repo, canonical, CONTRACT_KINDS);
    if (metadata.relations.some(relation => relation.role === role && relation.target === canonical)) throw new ConcordError('DuplicateLink', `${role}: ${canonical}`);
    return changed(repo, 'link-memory', record, { ...metadata, relations: [...metadata.relations, { role, target: canonical }] }, record.body, dryRun);
  });
}

// @concord-code
// @concord-implements docs/feature/feedback/use-case/manage-local-observations.md#操作-spec
export function linkIssue(repo: Repository, selector: string, memoryRef: string, dryRun = false, kind: Exclude<IssueRelation['role'], 'adopts'> | 'adopts' = 'investigation'): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
  if (kind === 'adopts') return adoptIssue(repo, selector, memoryRef, dryRun);
  const record = readDocumentSelector(repo, selector, 'issue');
  if (record.metadata.kind !== 'issue') throw new ConcordError('InvalidDocumentKind', selector);
  if (record.metadata.status !== 'open') throw new ConcordError('InvalidIssueState', 'Closed Issue cannot gain links');
  decode(Schema.Literals(MEMORY_RELATION_KINDS), kind, 'relation kind');
  const target = readDocumentReference(repo, memoryRef, kind === 'related' ? ['issue'] : ['memory']); const canonical = parseReference(memoryRef).ref;
  if (target.metadata.kind === 'memory' && !['current', 'superseded'].includes(target.metadata.status)) throw new ConcordError('InvalidMemoryState', 'Issue relations require current or superseded Memory');
  if (kind === 'related' && target.path === record.path) throw new ConcordError('InvalidReferenceTarget', 'related requires another Issue');
  if (record.metadata.relations.some((relation) => relation.target === canonical && relation.role === kind)) throw new ConcordError('DuplicateLink', `${canonical} is already linked`);
  return changed(repo, 'link-issue', record, { ...record.metadata, relations: [...record.metadata.relations, { role: kind, target: canonical }] }, record.body, dryRun);
  });
}

export function unlinkIssue(repo: Repository, selector: string, reference: string, dryRun = false, role: Exclude<IssueRelation['role'], 'adopts'> | 'adopts' = 'investigation'): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
    if (role === 'adopts') return retireIssue(repo, selector, reference, dryRun);
    const record = readDocumentSelector(repo, selector, 'issue');
    if (record.metadata.kind !== 'issue') throw new ConcordError('InvalidDocumentKind', selector);
    if (record.metadata.status !== 'open') throw new ConcordError('InvalidIssueState', 'Closed Issue must be reopened before unlinking');
    const canonical = parseReference(reference).ref;
    const relations = record.metadata.relations.filter(item => item.role !== role || item.target !== canonical);
    if (relations.length === record.metadata.relations.length) throw new ConcordError('LinkNotFound', `${role}: ${canonical}`);
    return changed(repo, 'unlink-issue', record, { ...record.metadata, relations: relations }, record.body, dryRun);
  });
}

// @concord-code
// @concord-implements docs/feature/feedback/use-case/triage-feedback.md
export function linkFeedbackFeature(repo: Repository, selector: string, featureRef: string, dryRun = false): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
    const target = findDocument(loadDocuments(repo), featureRef, 'feature');
    return adoptIssue(repo, selector, target.path, dryRun);
  });
}

// @concord-code
// @concord-implements docs/feature/feedback/use-case/manage-local-observations.md#操作-spec
export function closeIssue(repo: Repository, selector: string, closureInput: string | IssueClosure, dryRun = false): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
  const documents = loadDocuments(repo); const record = findDocument(documents, selector, 'issue');
  if (record.metadata.kind !== 'issue') throw new ConcordError('InvalidDocumentKind', selector);
  if (record.metadata.status !== 'open' && !(record.metadata.closure?.kind === 'fixed' && record.metadata.closure.verification === undefined)) throw new ConcordError('InvalidIssueState', 'Issue is already closed');
  const closure = decode(IssueClosureSchema, typeof closureInput === 'string' ? { kind: 'closed', reason: closureInput } : closureInput, 'Issue closure');
  const at = now(); const why = closure.kind === 'closed' ? closure.reason : closure.kind;
  const metadata = { ...record.metadata, status: 'closed' as const, closure };
  const candidate = { ...record, metadata };
  const findings = checkIssueClosure(repo, documents.map(document => document.path === record.path ? candidate : document), candidate);
  if (findings.length > 0) throw new ConcordError(findings[0]!.code, findings[0]!.message, { findings });
  return changed(repo, 'close-issue', record, metadata, record.body, dryRun);
  });
}

// @concord-code
// @concord-implements docs/feature/feedback/use-case/manage-local-observations.md#操作-spec
export function adoptIssue(repo: Repository, selector: string, reference: string, dryRun = false): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
    const documents = loadDocuments(repo); const record = findDocument(documents, selector, 'issue');
    if (record.metadata.kind !== 'issue' || record.metadata.status !== 'open') throw new ConcordError('InvalidIssueState', 'Only a draft Issue can adopt a contract');
    const parsed = parseReference(reference);
    const target = resolveReference(repo, documents, reference, CONTRACT_KINDS);
    const canonical = parsed.ref;
    if (record.metadata.relations.some(relation => relation.role === 'adopts' && relation.target === canonical)) throw new ConcordError('DuplicateLink', `${canonical} is already adopted`);
    return changed(repo, 'adopt-issue', record, { ...record.metadata, relations: [...record.metadata.relations, { role: 'adopts', target: canonical }] }, record.body, dryRun);
  });
}

// @concord-code
// @concord-implements docs/feature/feedback/use-case/manage-local-observations.md#操作-spec
export function retireIssue(repo: Repository, selector: string, reference: string, dryRun = false): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
    const record = findDocument(loadDocuments(repo), selector, 'issue');
    if (record.metadata.kind !== 'issue') throw new ConcordError('InvalidDocumentKind', selector);
    const canonical = parseReference(reference).ref;
    if (!record.metadata.relations.some(relation => relation.role === 'adopts' && relation.target === canonical)) throw new ConcordError('InvalidIssueState', `${canonical} is not a current adoption`);
    if (record.metadata.status !== 'open') throw new ConcordError('InvalidIssueState', 'Closed Issue must be reopened before unlinking');
    return changed(repo, 'retire-issue', record, { ...record.metadata, relations: record.metadata.relations.filter(relation => relation.role !== 'adopts' || relation.target !== canonical) }, record.body, dryRun);
  });
}

// @concord-code
// @concord-implements docs/feature/feedback/use-case/manage-local-observations.md#操作-spec
export function reopenIssue(repo: Repository, selector: string, reason: string, dryRun = false): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
    const record = findDocument(loadDocuments(repo), selector, 'issue');
    if (record.metadata.kind !== 'issue' || record.metadata.status !== 'closed') throw new ConcordError('InvalidIssueState', 'Only a closed Issue can reopen');
    const why = required(reason, 'reason'); const { closure: _, ...metadata } = record.metadata;
    return changed(repo, 'reopen-issue', record, { ...metadata, status: 'open' }, record.body, dryRun);
  });
}
