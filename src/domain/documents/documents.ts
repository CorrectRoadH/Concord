import { readDesignPlanPaths } from "../../base/sources/index.js";
import { posix } from "node:path";

import { deriveDesignRecord } from "./design-record.js";



import { decodeDocumentSource as parseDocumentSource } from "./document-codec.js";
import { renderDocument } from "../../model/index.js";

import { ConcordError, DocumentName, Text, decode, digest, inRepositorySnapshot, type DocumentKind, type DocumentMeta, type DocumentRecord, type Finding, type MemoryMeta, type MutationReceipt, type Repository } from "../../model/index.js";

import { resolveReference } from "./refs.js";
import { parseReference } from "../../model/index.js";




import { inspectDocumentProjections, projectionRecord } from "./document-projection.js";
import { designContentPaths } from "../../model/index.js";
import { validateDesignContent } from "./design-content.js";

import { DOCUMENT_ROOTS, documentDisposition, documentPlacementError, matchingOwners } from "../../model/index.js";


// @concord-code
// @concord-implements docs/feature/local-sdlc/architecture.md#操作依赖
export function documentRoots(repo: Repository): readonly string[] {
  return inRepositorySnapshot(repo, () => { return [...DOCUMENT_ROOTS, ...['memory']];   });
}
export const CONTRACT_KINDS: readonly DocumentKind[] = ['feature', 'use-case', 'engineering'];
export const now = (): string => new Date().toISOString();

// @concord-begin
// @concord-implements docs/feature/local-sdlc/architecture.md#编译管线
export function required(value: string | undefined, field: string): string {
  if (value === undefined || value.length === 0 || value.trim() !== value) throw new ConcordError('InvalidInput', `${field} must be non-empty and have no surrounding whitespace`);
  return decode(Text, value, field);
}

export function authorBody(value: string): string {
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
export function changed(repo: Repository, operation: string, record: DocumentRecord, metadata: DocumentMeta, body = record.body, dryRun = false): MutationReceipt {
  return repo.publish(operation, [{ path: record.path, before: preimage(repo, record), after: renderDocument(metadata, body) }], dryRun);
}

function preimage(repo: Repository, record: DocumentRecord): string {
  const source = repo.read(record.path);
  if (source === undefined || digest(source) !== record.digest) throw new ConcordError('PreimageChanged', `${record.path} changed; reload the document and retry`);
  return source;
}

export function memory(record: DocumentRecord): MemoryMeta {
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



// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/review-traceability.md#check
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

export function checkIssueClosure(repo: Repository, documents: readonly DocumentRecord[], document: DocumentRecord): Finding[] {
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

export function designSnapshot(repo: Repository, record: DocumentRecord): Map<string, string | undefined> {
  if (record.metadata.kind !== 'design') throw new ConcordError('InvalidDocumentKind', record.path);
  const base = posix.dirname(record.path);
  const supporting = repo.files(base).filter(path => path.endsWith('.md'));
  readDesignPlanPaths(repo.root, base, record.metadata.alternatives);
  const paths = [...new Set([...designContentPaths(base, record.metadata.alternatives), ...supporting])];
  const snapshot = new Map(paths.map(path => [path, path === record.path ? preimage(repo, record) : repo.read(path)]));
  return snapshot;
}
