// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#操作依赖
import { Predicate } from 'effect';
import { parseDocument } from 'yaml';
import { ConcordError, DocumentSchema, decode, digest, type DocumentRecord } from './shared.js';

/** Projection construction only; location-dependent validation runs on every use. */
export function decodeUncachedDocumentSource(path: string, source: string): DocumentRecord | undefined {
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
  // Native lifecycle writers have emitted shared YAML values in this same format.
  // Bound expansion before strict Schema decoding, rather than rejecting those owners.
  let value: unknown;
  try { value = yaml.toJS({ maxAliasCount: 100 }); }
  catch (cause) { throw new ConcordError('InvalidData', `${path}: ${cause instanceof Error ? cause.message : String(cause)}`); }
  if (!Predicate.isObject(value) || typeof value.format !== 'string') {
    if (claimsConcord) throw new ConcordError('InvalidData', `${path}: invalid Concord frontmatter`);
    return undefined;
  }
  if (!value.format.startsWith('concord.document/')) return undefined;
  const metadata = decode(DocumentSchema, value, path);
  return { path, metadata, body: match[2]!.replace(/^\r?\n/u, ''), digest: digest(source) };
}
