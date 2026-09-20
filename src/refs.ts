// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/review-traceability.md
// @concord-implements docs/feature/local-sdlc/use-case/trace-code-ownership.md
import { posix } from 'node:path';
import { ConcordError, type DocumentKind, type DocumentRecord, type Repository } from './shared.js';

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
  repo: Repository,
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
    owner = documents
      .filter(document => document.metadata.kind === 'feature' || document.metadata.kind === 'engineering' || document.metadata.kind === 'research')
      .filter(document => parsed.path.startsWith(`${posix.dirname(document.path)}/`))
      .sort((left, right) => right.path.length - left.path.length)[0];
    if (owner === undefined) throw new ConcordError('ReferenceNotFound', `Supporting Markdown is outside a Feature, Engineering, or Research package: ${input}`);
    const nestedOwner = documents.find(document =>
      document.path !== owner?.path &&
      parsed.path.startsWith(`${posix.dirname(document.path)}/`) &&
      document.metadata.kind !== 'feature' && document.metadata.kind !== 'engineering' && document.metadata.kind !== 'research');
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
