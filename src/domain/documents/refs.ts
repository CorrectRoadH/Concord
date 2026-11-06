// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#操作依赖
import { parseReference } from "../../model/index.ts";
import { posix } from "node:path";
import { ConcordError, type DocumentKind, type DocumentRecord, type Finding, type Repository } from "../../model/index.ts";
import { decodeDocumentSource } from "./document-codec.ts";
import { markdown_facts_markdownAnchor as markdownAnchor } from "../../model/index.ts";
import { extractSteps } from "./steps.ts";
import type { RuntimeEnvironmentSnapshot } from '../../base/environment/index.ts';
import { repositoryRuntime } from '../../base/workspace/index.ts';
import { makeDocumentProjectionCache } from './document-projection.ts';

function hasAnchor(source: string, expected: string): boolean {
  const collapsed = (value: string) => value.replace(/-+/gu, '-').replace(/^-+|-+$/gu, '');
  return source.split(/\r?\n/u).some(line => {
    const actual = markdownAnchor(line);
    return actual === expected || (actual !== undefined && collapsed(actual) === expected);
  });
}

/**
 * Resolves exact Concord owners and supporting Markdown inside the deepest
 * Feature or Engineering package. Derived from NiceEval's docs/trace/ref.ts; its formats and
 * runtime-specific Result errors intentionally do not cross this boundary.
 */
export function resolveReference(
  repo: Repository,
  documents: readonly DocumentRecord[],
  input: string,
  allowedKinds?: readonly DocumentKind[],
): DocumentRecord {
  const runtime = repositoryRuntime(repo), contentCache = makeDocumentProjectionCache(runtime);
  try { return resolveReferenceInScope(repo, documents, input, allowedKinds, runtime, contentCache); }
  finally { contentCache.close(); }
}

function resolveReferenceInScope(
  repo: Pick<Repository, 'read'>, documents: readonly DocumentRecord[], input: string,
  allowedKinds: readonly DocumentKind[] | undefined, runtime: RuntimeEnvironmentSnapshot,
  contentCache: ReturnType<typeof makeDocumentProjectionCache>,
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
    if (decodeDocumentSource(parsed.path, source, runtime, contentCache) !== undefined) throw new ConcordError('ReferenceNotFound', `Reference owner is absent from the current inventory: ${input}`);
    owner = documents
      .filter(document => document.metadata.kind === 'feature' || document.metadata.kind === 'engineering')
      .filter(document => parsed.path.startsWith(`${posix.dirname(document.path)}/`))
      .sort((left, right) => right.path.length - left.path.length)[0];
    if (owner === undefined) throw new ConcordError('ReferenceNotFound', `Supporting Markdown is outside a Feature or Engineering package: ${input}`);
    for (let directory = posix.dirname(parsed.path); directory !== posix.dirname(owner.path); directory = posix.dirname(directory)) {
      const boundary = `${directory}/README.md`;
      if (boundary === parsed.path) continue;
      const bytes = repo.read(boundary);
      if (bytes !== undefined && decodeDocumentSource(boundary, bytes, runtime, contentCache) !== undefined) throw new ConcordError('InvalidReferenceTarget', `Supporting Markdown crosses owner ${boundary}; reference its owner directly`);
    }
    const nestedOwner = documents.find(document =>
      document.path !== owner?.path &&
      document.path.endsWith('/README.md') &&
      parsed.path.startsWith(`${posix.dirname(document.path)}/`) &&
      document.metadata.kind !== 'feature' && document.metadata.kind !== 'engineering');
    if (nestedOwner !== undefined) throw new ConcordError('InvalidReferenceTarget', `Supporting Markdown is inside ${nestedOwner.metadata.kind} ${nestedOwner.path}; reference its owner directly`);
  }
  if (allowedKinds !== undefined && !allowedKinds.includes(owner.metadata.kind)) {
    throw new ConcordError('InvalidReferenceTarget', `${input} resolves to ${owner.metadata.kind}; expected ${allowedKinds.join(', ')}`);
  }
  if (parsed.anchor !== undefined && (source === undefined || (!hasAnchor(source, parsed.anchor) && !(owner.metadata.kind === 'use-case' && owner.path === parsed.path && extractSteps(parsed.path, source, runtime, contentCache).steps.some(step => step.id === parsed.anchor))))) {
    throw new ConcordError('AnchorNotFound', `Anchor ${parsed.anchor} does not exist in ${parsed.path}`);
  }
  return owner;
}

/** One graph compilation owns these temporary results and rechecks all read bytes. */
export function referenceResolver(repo: Repository, documents: readonly DocumentRecord[]) {
  const runtime = repositoryRuntime(repo);
  const sources = new Map<string, string | undefined>();
  const resolved = new Map<string, DocumentRecord>();
  const failures = new Map<string, unknown>();
  const reader = { read(path: string): string | undefined {
    if (sources.has(path)) return sources.get(path);
    const source = repo.read(path);
    sources.set(path, source);
    return source;
  } };
  return {
    resolve(input: string, allowedKinds?: readonly DocumentKind[]): DocumentRecord {
      const key = JSON.stringify([input, allowedKinds]);
      if (failures.has(key)) throw failures.get(key);
      const previous = resolved.get(input);
      if (previous !== undefined) {
        if (allowedKinds !== undefined && !allowedKinds.includes(previous.metadata.kind)) throw new ConcordError('InvalidReferenceTarget', `${input} resolves to ${previous.metadata.kind}; expected ${allowedKinds.join(', ')}`);
        return previous;
      }
      let owner: DocumentRecord;
      const contentCache = makeDocumentProjectionCache(runtime);
      try { owner = resolveReferenceInScope(reader, documents, input, allowedKinds, runtime, contentCache); }
      catch (cause) { failures.set(key, cause); throw cause; }
      finally { contentCache.close(); }
      resolved.set(input, owner);
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
