// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/use-unified-cache.md
import { markdownBody } from "../../model/index.ts";
import { Schema } from "effect";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import type { Root } from "mdast";
import type { RuntimeEnvironmentSnapshot } from '../../base/environment/index.ts';
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
export const makeDocumentProjectionCache = (runtime: RuntimeEnvironmentSnapshot) => new ContentCache('document_parse', DOCUMENT_PARSER_VERSION, Projection,
  { maxEntries: 9872, maxBytes: 15 * 1024 * 1024 }, runtime);
type DocumentProjectionCache = ReturnType<typeof makeDocumentProjectionCache>;
function withProjectionCache<A>(runtime: RuntimeEnvironmentSnapshot, contentCache: DocumentProjectionCache | undefined, use: (cache: DocumentProjectionCache) => A): A {
  const cache = contentCache ?? makeDocumentProjectionCache(runtime);
  try { return use(cache); }
  finally { if (contentCache === undefined) cache.close(); }
}
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
  try {
    return decode(Schema.fromJsonString(MarkdownRoot), inflateRawSync(Buffer.from(tree, 'base64'), { maxOutputLength: 64 * 1024 * 1024 }).toString('utf8'), 'document syntax tree');
  } catch (cause) {
    if (cause instanceof ConcordError) throw cause;
    throw new ConcordError('InvalidData', `document syntax tree: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}
function currentTree(input: { readonly source: string }, previous: Projection): Root {
  return projectionTree(input.source, previous);
}
/** Decode detached syntax bytes without retaining the cache that produced them. */
export function projectionTree(source: string, previous: Projection): Root {
  if (previous.tree !== undefined) return decodeTree(previous.tree);
  return fromMarkdown(markdownBody(source));
}
function withMarkdown(input: { readonly path: string; readonly source: string }, previous = parseMetadata(input), tree = currentTree(input, previous)): Projection {
  const { items: _items, ...steps } = inspectTreeSteps(input.path, input.source, previous.record?.metadata.kind === 'use-case', tree);
  return { ...previous, tree: serializeTree(tree), markdown: { anchors: [...headingAnchorsFromTree(input.source, tree)], links: inlineLinksFromTree(tree), steps } };
}
export function documentProjection(path: string, source: string, runtime: RuntimeEnvironmentSnapshot, contentCache?: DocumentProjectionCache) {
  return withProjectionCache(runtime, contentCache, cache => cache.get(path, source, () => parseMetadata({ path, source })));
}
export function inspectDocumentProjections(inputs: readonly { readonly path: string; readonly source: string }[], markdown = false, runtime: RuntimeEnvironmentSnapshot, contentCache?: DocumentProjectionCache) {
  return withProjectionCache(runtime, contentCache, cache => cache.getManyResults(inputs, (input, previous) => markdown ? withMarkdown(input, previous) : parseMetadata(input), false, markdown ? value => value.markdown !== undefined : undefined));
}
export function documentMarkdownProjection(path: string, source: string, runtime: RuntimeEnvironmentSnapshot, contentCache?: DocumentProjectionCache) {
  return withProjectionCache(runtime, contentCache, cache => {
    const projection = cache.get(path, source, previous => withMarkdown({ path, source }, previous), false, value => value.markdown !== undefined);
    return { ...projection, ...projection.markdown! };
  });
}
export function documentMarkdown(path: string, source: string, runtime: RuntimeEnvironmentSnapshot, contentCache?: DocumentProjectionCache): Root {
  return withProjectionCache(runtime, contentCache, cache => {
    const projection = documentMarkdownProjection(path, source, runtime, cache);
    // Decode the serialized tree only for consumers that need nodes and offsets.
    return decodeTree(projection.tree!);
  });
}
export function projectionRecord(path: string, projection: Projection) {
  if (projection.error !== undefined) throw new ConcordError(projection.error.code, projection.error.message);
  const record = projection.record;
  return record;
}
