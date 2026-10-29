// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/use-unified-cache.md
import { Schema } from 'effect';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import type { Root } from 'mdast';
import { ContentCache } from './content-cache.js';
import { decodeUncachedDocumentSource } from './document-source.js';
import { fromMarkdown } from './markdown-parser.js';
import { MarkdownRoot } from './markdown-schema.js';
import { headingAnchorsFromTree, inlineLinksFromTree, inspectTreeSteps } from './markdown-facts.js';
import { ConcordError, decode, DocumentSchema } from './shared.js';

/** Bump when Markdown/YAML parsers, schemas, masking, or path rules change. */
export const DOCUMENT_PARSER_VERSION = 'concord-document-projection/v3:mdast-2.0.3:yaml-2.9.0';
const Record = Schema.Struct({ path: Schema.String, metadata: DocumentSchema, body: Schema.String, digest: Schema.String });
const Marker = Schema.Struct({ line: Schema.Int, startColumn: Schema.Int, endColumn: Schema.Int });
const Steps = Schema.Struct({
  steps: Schema.Array(Schema.Struct({ id: Schema.String, ordinal: Schema.Int, line: Schema.Int, endLine: Schema.Int, listOrdinal: Schema.Int })),
  lists: Schema.Array(Schema.Struct({ ordinal: Schema.Int, line: Schema.Int, endLine: Schema.Int, items: Schema.Int, marked: Schema.Int })),
  markers: Schema.Array(Marker), findings: Schema.Array(Schema.Struct({ code: Schema.String, path: Schema.String, message: Schema.String, line: Schema.optional(Schema.Int) })),
});
const Projection = Schema.Struct({ record: Schema.optional(Record), error: Schema.optional(Schema.Struct({ code: Schema.String, message: Schema.String })), anchors: Schema.Array(Schema.String), links: Schema.Array(Schema.Struct({ url: Schema.String, line: Schema.Int })), steps: Steps, tree: Schema.String });
const cache = new ContentCache('document_parse', DOCUMENT_PARSER_VERSION, Projection,
  { maxEntries: 9872, maxBytes: 15 * 1024 * 1024 }, 'document_parse_cache');

/** Mask metadata without moving any body offsets or line numbers. */
export function markdownBody(source: string): string {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, value => value.replace(/[^\r\n]/gu, ' '));
}
function parse(input: { readonly path: string; readonly source: string }, tree = fromMarkdown(markdownBody(input.source))) {
  let record: ReturnType<typeof decodeUncachedDocumentSource>;
  let error: { code: string; message: string } | undefined;
  try { record = decodeUncachedDocumentSource(input.path, input.source); }
  catch (cause) {
    if (!(cause instanceof ConcordError)) throw cause;
    error = { code: cause.code, message: cause.message };
  }
  const { items: _items, ...steps } = inspectTreeSteps(input.path, input.source, record?.metadata.kind === 'use-case', tree);
  return { ...(record === undefined ? {} : { record }), ...(error === undefined ? {} : { error }), anchors: [...headingAnchorsFromTree(input.source, tree)], links: inlineLinksFromTree(tree), steps, tree: deflateRawSync(JSON.stringify(tree), { level: 1 }).toString('base64') };
}
export function documentProjection(path: string, source: string) { return cache.get(path, source, () => parse({ path, source })); }
export function inspectDocumentProjections(inputs: readonly { readonly path: string; readonly source: string }[]) { return cache.getManyResults(inputs, parse); }
export function documentMarkdown(path: string, source: string): Root {
  const projection = documentProjection(path, source);
  try {
    // Decode the serialized tree only for consumers that need nodes and offsets.
    return decode(MarkdownRoot, JSON.parse(inflateRawSync(Buffer.from(projection.tree, 'base64'), { maxOutputLength: 64 * 1024 * 1024 }).toString('utf8')), 'document syntax tree');
  } catch {
    const tree = fromMarkdown(markdownBody(source));
    cache.get(path, source, () => parse({ path, source }, tree), true);
    return tree;
  }
}
export function projectionRecord(path: string, projection: Schema.Schema.Type<typeof Projection>) {
  if (projection.error !== undefined) throw new ConcordError(projection.error.code, projection.error.message);
  const record = projection.record;
  if (record?.metadata.kind === 'research' && !path.endsWith('/README.md')) throw new ConcordError('ResearchMigrationRequired', `${path}: Research owners must use a topic directory with README.md; run the offline document package migration`);
  return record;
}
