// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/review-traceability.md
// @concord-implements docs/feature/local-sdlc/use-case/trace-code-ownership.md
import { resolveDesignPlanPath } from './document-layout.js';
import { posix } from 'node:path';
import { ConcordError, type DocumentKind, type DocumentRecord, type Finding, type Repository } from './shared.js';
import { decodeDocumentSource } from './document-codec.js';

export interface ParsedReference {
  readonly path: string;
  readonly anchor?: string;
  readonly ref: string;
}

export function parseReference(input: string): ParsedReference {
  if (typeof input !== 'string' || input.length === 0 || input.trim() !== input || input.startsWith('/') || input.includes('\\') || input.includes('\0')) {
    throw new ConcordError('InvalidReference', `Expected a canonical repository reference: ${String(input)}`);
  }
  const firstHash = input.indexOf('#');
  if (firstHash !== input.lastIndexOf('#')) throw new ConcordError('InvalidReference', `Reference has more than one anchor: ${input}`);
  const path = firstHash < 0 ? input : input.slice(0, firstHash);
  const anchor = firstHash < 0 ? undefined : input.slice(firstHash + 1);
  if (!path || path.endsWith('/') || path.includes('//') || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new ConcordError('InvalidReference', `Expected a canonical repository reference: ${input}`);
  }
  if (anchor !== undefined && (!anchor || anchor.trim() !== anchor || /[#/?\\\s]/u.test(anchor))) {
    throw new ConcordError('InvalidReference', `Expected a canonical Markdown anchor: ${input}`);
  }
  return anchor === undefined ? { path, ref: input } : { path, anchor, ref: input };
}

export function markdownAnchor(line: string): string | undefined {
  const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/u.exec(line)?.[1];
  if (heading === undefined) return undefined;
  const explicit = /\s+\{#([A-Za-z][A-Za-z0-9_.:-]*)\}\s*$/u.exec(heading)?.[1];
  if (explicit !== undefined) return explicit;
  if (heading.includes('{#')) return undefined;
  return heading.toLocaleLowerCase().replace(/[^\p{Letter}\p{Number}\s-]/gu, '').replace(/\s/gu, '-');
}

function hasAnchor(source: string, expected: string): boolean {
  const collapsed = (value: string) => value.replace(/-+/gu, '-').replace(/^-+|-+$/gu, '');
  return source.split(/\r?\n/u).some(line => {
    const actual = markdownAnchor(line);
    return actual === expected || (actual !== undefined && collapsed(actual) === expected);
  });
}

/**
 * Resolves exact Concord owners and supporting Markdown inside the deepest
 * Feature, Engineering, or Research package. Derived from NiceEval's docs/trace/ref.ts; its formats and
 * runtime-specific Result errors intentionally do not cross this boundary.
 */
export function resolveReference(
  repo: Pick<Repository, 'read'>,
  documents: readonly DocumentRecord[],
  input: string,
  allowedKinds?: readonly DocumentKind[],
): DocumentRecord {
  const parsed = parseReference(input);
  let source: string | undefined;
  let owner = documents.find(document => document.path === parsed.path);
  if (owner !== undefined) {
    source = repo.read(parsed.path);
  } else {
    if (!parsed.path.endsWith('.md')) throw new ConcordError('ReferenceNotFound', `Reference is not a Concord document or supporting Markdown page: ${input}`);
    source = repo.read(parsed.path);
    if (source === undefined) throw new ConcordError('ReferenceNotFound', `Reference target does not exist: ${input}`);
    // A partial inventory may have omitted a malformed or historical owner.
    // Its bytes still define a boundary; never reinterpret it as an ancestor's page.
    if (decodeDocumentSource(parsed.path, source) !== undefined) throw new ConcordError('ReferenceNotFound', `Reference owner is absent from the current inventory: ${input}`);
    owner = documents
      .filter(document => document.metadata.kind === 'feature' || document.metadata.kind === 'engineering' || document.metadata.kind === 'research' || document.metadata.kind === 'design')
      .filter(document => parsed.path.startsWith(`${posix.dirname(document.path)}/`))
      .sort((left, right) => right.path.length - left.path.length)[0];
    if (owner === undefined) throw new ConcordError('ReferenceNotFound', `Supporting Markdown is outside a Feature, Engineering, or Research package: ${input}`);
    if (owner.metadata.kind === 'design') {
      const base = posix.dirname(owner.path);
      const relative = parsed.path.slice(base.length + 1);
      if (relative.startsWith('plans/')) {
        const part = relative.split('/')[1]!;
        const name = relative.split('/').length === 2 && part.endsWith('.md') ? part.slice(0, -3) : part;
        if (!owner.metadata.alternatives.includes(name)) throw new ConcordError('InvalidPlan', `Undeclared candidate: ${name}`);
        const entry = resolveDesignPlanPath(base, name, path => path.endsWith('.md') && repo.read(path) !== undefined);
        if (!entry.endsWith('/README.md') && parsed.path !== entry) throw new ConcordError('InvalidReferenceTarget', 'Single-file Plans have no supporting pages');
      }
    }
    for (let directory = posix.dirname(parsed.path); directory !== posix.dirname(owner.path); directory = posix.dirname(directory)) {
      const boundary = `${directory}/README.md`;
      if (boundary === parsed.path) continue;
      const bytes = repo.read(boundary);
      if (bytes !== undefined && decodeDocumentSource(boundary, bytes) !== undefined) throw new ConcordError('InvalidReferenceTarget', `Supporting Markdown crosses owner ${boundary}; reference its owner directly`);
    }
    const nestedOwner = documents.find(document =>
      document.path !== owner?.path &&
      parsed.path.startsWith(`${posix.dirname(document.path)}/`) &&
      document.metadata.kind !== 'feature' && document.metadata.kind !== 'engineering' && document.metadata.kind !== 'research' && document.metadata.kind !== 'design');
    if (nestedOwner !== undefined) throw new ConcordError('InvalidReferenceTarget', `Supporting Markdown is inside ${nestedOwner.metadata.kind} ${nestedOwner.path}; reference its owner directly`);
  }
  if (allowedKinds !== undefined && !allowedKinds.includes(owner.metadata.kind)) {
    throw new ConcordError('InvalidReferenceTarget', `${input} resolves to ${owner.metadata.kind}; expected ${allowedKinds.join(', ')}`);
  }
  if (parsed.anchor !== undefined && (source === undefined || !hasAnchor(source, parsed.anchor))) {
    throw new ConcordError('AnchorNotFound', `Anchor ${parsed.anchor} does not exist in ${parsed.path}`);
  }
  return owner;
}

/** One graph compilation owns these temporary results and rechecks all read bytes. */
export function referenceResolver(repo: Repository, documents: readonly DocumentRecord[]) {
  const sources = new Map<string, string | undefined>();
  const resolved = new Map<string, DocumentRecord>();
  const reader = { read(path: string): string | undefined {
    if (sources.has(path)) return sources.get(path);
    const source = repo.read(path);
    sources.set(path, source);
    return source;
  } };
  return {
    resolve(input: string, allowedKinds?: readonly DocumentKind[]): DocumentRecord {
      const key = JSON.stringify([input, allowedKinds]);
      const previous = resolved.get(key);
      if (previous !== undefined) return previous;
      const owner = resolveReference(reader, documents, input, allowedKinds);
      resolved.set(key, owner);
      return owner;
    },
    verify(): Finding[] {
      const findings: Finding[] = [];
      for (const [path, source] of sources) {
        try {
          if (repo.read(path) !== source) findings.push({ code: 'SourceChanged', path, message: 'Reference source changed while the relationship graph was compiled' });
        } catch (cause) {
          findings.push({ code: cause instanceof ConcordError ? cause.code : 'InvalidReference', path, message: cause instanceof Error ? cause.message : String(cause) });
        }
      }
      return findings;
    },
  };
}
