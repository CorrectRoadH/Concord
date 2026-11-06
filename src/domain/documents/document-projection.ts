// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/use-unified-cache.md
import { markdownBody } from "../../model/index.ts";
import { Schema } from "effect";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import type { Root } from "mdast";
import { ContentCache } from "../../base/cache/index.ts";
import { decodeUncachedDocumentSource, ownerKind } from "../../model/index.ts";
import { fromMarkdown } from "../../model/index.ts";
import { MarkdownRoot } from "../../model/index.ts";
import { headingAnchorsFromTree, inlineLinksFromTree, inspectTreeSteps } from "../../model/index.ts";
import { ConcordError, decode, DocumentSchema } from "../../model/index.ts";

/** Bump when Markdown/YAML parsers, schemas, masking, or path rules change. */
export const DOCUMENT_PARSER_VERSION = 'concord-document-memory/v10:issue-spec-relations:mdast-2.0.3:yaml-2.9.0';
const Record = Schema.Struct({ path: Schema.String, metadata: DocumentSchema, body: Schema.String, digest: Schema.String });
const Marker = Schema.Struct({ line: Schema.Int, startColumn: Schema.Int, endColumn: Schema.Int });
const Steps = Schema.Struct({
  steps: Schema.Array(Schema.Struct({ id: Schema.String, ordinal: Schema.Int, line: Schema.Int, endLine: Schema.Int, listOrdinal: Schema.Int })),
  lists: Schema.Array(Schema.Struct({ ordinal: Schema.Int, line: Schema.Int, endLine: Schema.Int, items: Schema.Int, marked: Schema.Int })),
  markers: Schema.Array(Marker), findings: Schema.Array(Schema.Struct({ code: Schema.String, path: Schema.String, message: Schema.String, line: Schema.optional(Schema.Int) })),
});
const Metadata = { record: Schema.optional(Record), error: Schema.optional(Schema.Struct({ code: Schema.String, message: Schema.String })), tree: Schema.optional(Schema.String) };
const Markdown = Schema.Struct({ anchors: Schema.Array(Schema.String), links: Schema.Array(Schema.Struct({ url: Schema.String, line: Schema.Int })), steps: Steps });
const Projection = Schema.Struct({ ...Metadata, markdown: Schema.optional(Markdown) });
type Projection = Schema.Schema.Type<typeof Projection>;
const cache = new ContentCache('document_parse', DOCUMENT_PARSER_VERSION, Projection,
  { maxEntries: 9872, maxBytes: 15 * 1024 * 1024 });
function parseMetadata(input: { readonly path: string; readonly source: string }): Projection {
  let record: ReturnType<typeof decodeUncachedDocumentSource>;
  let error: { code: string; message: string } | undefined;
  const tree = ownerKind(input.path) === undefined ? undefined : fromMarkdown(markdownBody(input.source));
  try { record = decodeUncachedDocumentSource(input.path, input.source, tree); }
  catch (cause) {
    if (!(cause instanceof ConcordError)) throw cause;
    error = { code: cause.code, message: cause.message };
  }
  return { ...(record === undefined ? {} : { record }), ...(error === undefined ? {} : { error }), ...(tree === undefined ? {} : { tree: serializeTree(tree) }) };
}
function serializeTree(tree: Root): string { return deflateRawSync(JSON.stringify(tree), { level: 1 }).toString('base64'); }
function decodeTree(tree: string): Root {
  return decode(MarkdownRoot, JSON.parse(inflateRawSync(Buffer.from(tree, 'base64'), { maxOutputLength: 64 * 1024 * 1024 }).toString('utf8')), 'document syntax tree');
}
function currentTree(input: { readonly source: string }, previous: Projection): Root {
  if (previous.tree !== undefined) try { return decodeTree(previous.tree); } catch { /* Rebuild a damaged disposable tree. */ }
  return fromMarkdown(markdownBody(input.source));
}
function withMarkdown(input: { readonly path: string; readonly source: string }, previous = parseMetadata(input), tree = currentTree(input, previous)): Projection {
  const { items: _items, ...steps } = inspectTreeSteps(input.path, input.source, previous.record?.metadata.kind === 'use-case', tree);
  return { ...previous, tree: serializeTree(tree), markdown: { anchors: [...headingAnchorsFromTree(input.source, tree)], links: inlineLinksFromTree(tree), steps } };
}
export function documentProjection(path: string, source: string) { return cache.get(path, source, () => parseMetadata({ path, source })); }
export function inspectDocumentProjections(inputs: readonly { readonly path: string; readonly source: string }[], markdown = false) {
  return cache.getManyResults(inputs, (input, previous) => markdown ? withMarkdown(input, previous) : parseMetadata(input), false, markdown ? value => value.markdown !== undefined : undefined);
}
export function documentMarkdownProjection(path: string, source: string) {
  const projection = cache.get(path, source, previous => withMarkdown({ path, source }, previous), false, value => value.markdown !== undefined);
  return { ...projection, ...projection.markdown! };
}
export function documentMarkdown(path: string, source: string): Root {
  const projection = documentMarkdownProjection(path, source);
  try {
    // Decode the serialized tree only for consumers that need nodes and offsets.
    return decodeTree(projection.tree!);
  } catch {
    const tree = fromMarkdown(markdownBody(source));
    cache.get(path, source, () => withMarkdown({ path, source }, projection, tree), true);
    return tree;
  }
}
export function projectionRecord(path: string, projection: Projection) {
  if (projection.error !== undefined) throw new ConcordError(projection.error.code, projection.error.message);
  const record = projection.record;
  return record;
}
