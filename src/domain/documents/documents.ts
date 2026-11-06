import { posix } from "node:path";
import type { RuntimeEnvironmentSnapshot } from '../../base/environment/index.ts';
import { repositoryRuntime } from '../../base/workspace/index.ts';




import { decodeDocumentSource as parseDocumentSource } from "./document-codec.ts";
import { renderDocument } from "../../model/index.ts";

import { ConcordError, DocumentName, Text, decode, digest, inRepositorySnapshot, type DocumentKind, type DocumentMeta, type DocumentRecord, type Finding, type MemoryMeta, type MutationReceipt, type Repository } from "../../model/index.ts";

import { resolveReference } from "./refs.ts";
import { parseReference } from "../../model/index.ts";




import { inspectDocumentProjections, projectionRecord, makeDocumentProjectionCache } from "./document-projection.ts";

import { DOCUMENT_ROOTS, documentDisposition, documentPlacementError, matchingOwners } from "../../model/index.ts";
import { packagePageKind, pageKindSuggestions } from '../../model/index.ts';
import { packagePagePaths } from './package-pages.ts';


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

export function parseDocumentRecord(path: string, source: string, runtime: RuntimeEnvironmentSnapshot, contentCache?: ReturnType<typeof makeDocumentProjectionCache>): DocumentRecord | undefined {
  return parseDocumentSource(path, source, runtime, contentCache);
}

export function inspectDocumentRecords(inputs: readonly { readonly path: string; readonly source: string }[], markdown = false, runtime: RuntimeEnvironmentSnapshot, contentCache?: ReturnType<typeof makeDocumentProjectionCache>) {
  return inspectDocumentProjections(inputs, markdown, runtime, contentCache).map((result, index) => {
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
  if (source === undefined || digest(source) !== record.digest) throw new ConcordError('FileChangedSinceRead', `${record.path} changed; reload the document and retry`);
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
export function loadDocuments(repo: Repository, kinds?: readonly DocumentKind[], contentCache?: ReturnType<typeof makeDocumentProjectionCache>): DocumentRecord[] {
  return inRepositorySnapshot(repo, () => loadDocumentsUnderSnapshot(repo, kinds, contentCache));
}
function documentInputs(repo: Repository, kinds?: readonly DocumentKind[]): { path: string; source: string }[] {
  const paths = new Set<string>();
  const roots = kinds === undefined ? documentRoots(repo) : [...new Set(kinds.flatMap(kind => kind === 'memory'
    ? ['memory']
    : kind === 'use-case' ? ['docs/feature', 'docs/engineering'] : [kind === 'issue' ? 'docs/issues' : `docs/${kind}`]))];
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

function loadDocumentsUnderSnapshot(repo: Repository, kinds?: readonly DocumentKind[], contentCache?: ReturnType<typeof makeDocumentProjectionCache>): DocumentRecord[] {
  return inspectDocumentRecords(documentInputs(repo, kinds), false, repositoryRuntime(repo), contentCache).map(result => { if (!result.ok) throw result.cause; return result.value; })
    .filter((record): record is DocumentRecord => currentDocument(repo, record) && (kinds === undefined || kinds.includes(record.metadata.kind)))
    ;
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
export function diagnoseDocuments(repo: Repository, kinds?: readonly DocumentKind[]): DocumentInventory {
  return inRepositorySnapshot(repo, () => {
    const documents: DocumentRecord[] = [], findings: Finding[] = [];
    const inputs = documentInputs(repo, kinds);
    const results = inspectDocumentRecords(inputs, true, repositoryRuntime(repo));
    for (const [index, input] of inputs.entries()) {
      try {
        const result = results[index]!;
        if (!result.ok) throw result.cause;
        const record = result.value;
        if (currentDocument(repo, record) && (kinds === undefined || kinds.includes(record.metadata.kind))) documents.push(record);
      } catch (cause) {
        if (!(cause instanceof ConcordError) || !['InvalidData', 'InvalidPlacement'].includes(cause.code)) throw cause;
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
    const runtime = repositoryRuntime(repo), contentCache = makeDocumentProjectionCache(runtime);
    try {
      const read = (path: string): DocumentRecord | undefined => {
        const source = repo.read(path);
        const record = source === undefined ? undefined : parseDocumentRecord(path, source, runtime, contentCache);
        if (record !== undefined && !currentDocument(repo, record)) throw new ConcordError('InvalidReferenceTarget', `${path} is not a current owner`);
        return record;
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
          const feature = readDocumentReference(repo, owner.metadata.feature, ['feature', 'engineering']);
          if (feature.path !== owner.metadata.feature) throw new ConcordError('InvalidPlacement', 'Use Case requires an exact Feature or Engineering owner');
          featurePath = feature.path;
        }
        const placement = documentPlacementError(owner.metadata.kind, owner.path, featurePath);
        if (placement !== undefined) throw new ConcordError('InvalidPlacement', placement);
      }
      return resolveReference(repo, records, reference, kinds);
    } finally { contentCache.close(); }
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

export function checkDocuments(repo: Repository, documents: readonly DocumentRecord[]): Finding[] {
  return inRepositorySnapshot(repo, () => {
  const findings: Finding[] = [];
  for (const owner of documents.filter(document => ['feature', 'engineering', 'roadmap'].includes(document.metadata.kind))) {
    const root = owner.path.slice(0, -'README.md'.length);
    const paths = packagePagePaths(repo, owner.path);
    for (const path of paths) if (/\.mdx?$/u.test(path) && packagePageKind(owner.path, path, paths) === 'unknown') {
      const relative = path.slice(root.length);
      findings.push({ code: 'UnknownPageKind', path, message: `Page kind is unknown: ${relative}`, details: { suggestions: [...pageKindSuggestions(relative)] } });
    }
  }
  const identities = new Map<string, DocumentRecord[]>();
  for (const document of documents) {
    const key = document.path;
    identities.set(key, [...(identities.get(key) ?? []), document]);
    let featurePath: string | undefined;
    if (document.metadata.kind === 'use-case') {
      try { featurePath = findDocument(documents.filter(candidate => ['feature', 'engineering'].includes(candidate.metadata.kind)), document.metadata.feature).path; } catch { /* Report placement and relation below. */ }
    }
    const placement = documentPlacementError(document.metadata.kind, document.path, featurePath);
    if (placement !== undefined) finding(findings, 'InvalidPlacement', document.path, placement);

    const metadata = document.metadata;
    if (metadata.kind === 'use-case') checkRef(findings, repo, documents, document, metadata.feature, ['feature', 'engineering'], 'feature');
    if (metadata.kind === 'roadmap') {
      if (metadata.state !== 'adopted' && metadata.adoptedAs !== undefined) finding(findings, 'InvalidState', document.path, 'Only an adopted Roadmap can have adoptedAs');
      if (metadata.state === 'cancelled' && metadata.cancellation === undefined) finding(findings, 'InvalidState', document.path, 'Cancelled Roadmap must retain its cancellation reason and source');
      if (metadata.state !== 'cancelled' && metadata.cancellation !== undefined) finding(findings, 'InvalidState', document.path, 'Only a cancelled Roadmap can have cancellation');
      if (metadata.state === 'adopted' && metadata.adoptedAs === undefined) finding(findings, 'InvalidState', document.path, 'Adopted Roadmap must identify its Feature');
      if (metadata.adoptedAs !== undefined) checkRef(findings, repo, documents, document, metadata.adoptedAs, ['feature'], 'adoptedAs');
    }
    if (metadata.kind === 'memory') for (const relation of metadata.relations) checkRef(findings, repo, documents, document, relation.target, CONTRACT_KINDS, 'supports');
    if (metadata.kind === 'issue') {
      for (const relation of metadata.relations) {
        const linked = checkRef(findings, repo, documents, document, relation.target, relation.role === 'related' ? ['issue'] : relation.role === 'spec' ? CONTRACT_KINDS : ['memory'], `relation (${relation.role})`);
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
  if (record.digest !== expectedDigest) throw new ConcordError('FileChangedSinceRead', `${record.path} changed; use its current digest`);
  return changed(repo, 'set-author', record, record.metadata, authorBody(body), dryRun);
  });
}
