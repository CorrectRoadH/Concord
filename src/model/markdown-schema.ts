// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/use-unified-cache.md
import { Schema } from "effect";
import type { PhrasingContent, BlockContent, DefinitionContent, Root } from "mdast";

const Point = Schema.Struct({ line: Schema.Int, column: Schema.Int, offset: Schema.Int });
const position = Schema.Struct({ start: Point, end: Point });
const at = { position };
const children = Schema.mutable(Schema.Array(Schema.suspend((): Schema.ConstraintDecoder<BlockContent | DefinitionContent> => Block)));
const inline = Schema.mutable(Schema.Array(Schema.suspend((): Schema.ConstraintDecoder<PhrasingContent> => Inline)));
const value = { value: Schema.String, ...at };
const resource = { url: Schema.String, title: Schema.NullOr(Schema.String) };
const reference = { identifier: Schema.String, label: Schema.String, referenceType: Schema.Literals(['shortcut', 'collapsed', 'full']) };

/** Exactly the CommonMark nodes produced by the pinned parser, without extensions. */
const Inline = Schema.Union([
  Schema.Struct({ type: Schema.Literals(['emphasis', 'strong']), children: inline, ...at }),
  Schema.Struct({ type: Schema.Literals(['text', 'html', 'inlineCode']), ...value }),
  Schema.Struct({ type: Schema.Literal('break'), ...at }),
  Schema.Struct({ type: Schema.Literal('link'), ...resource, children: inline, ...at }),
  Schema.Struct({ type: Schema.Literal('image'), ...resource, alt: Schema.String, ...at }),
  Schema.Struct({ type: Schema.Literal('linkReference'), ...reference, children: inline, ...at }),
  Schema.Struct({ type: Schema.Literal('imageReference'), ...reference, alt: Schema.String, ...at }),
]);
const Item = Schema.Struct({ type: Schema.Literal('listItem'), spread: Schema.Boolean, checked: Schema.optional(Schema.NullOr(Schema.Boolean)), children, ...at });
const Block = Schema.Union([
  Schema.Struct({ type: Schema.Literal('paragraph'), children: inline, ...at }),
  Schema.Struct({ type: Schema.Literal('blockquote'), children, ...at }),
  Schema.Struct({ type: Schema.Literal('heading'), depth: Schema.Literals([1, 2, 3, 4, 5, 6]), children: inline, ...at }),
  Schema.Struct({ type: Schema.Literal('list'), ordered: Schema.Boolean, start: Schema.NullOr(Schema.Int), spread: Schema.Boolean, children: Schema.mutable(Schema.Array(Item)), ...at }),
  Schema.Struct({ type: Schema.Literal('html'), ...value }),
  Schema.Struct({ type: Schema.Literal('code'), lang: Schema.NullOr(Schema.String), meta: Schema.NullOr(Schema.String), ...value }),
  Schema.Struct({ type: Schema.Literal('thematicBreak'), ...at }),
  Schema.Struct({ type: Schema.Literal('definition'), identifier: Schema.String, label: Schema.String, ...resource, ...at }),
]);
export const MarkdownRoot: Schema.ConstraintDecoder<Root> = Schema.Struct({ type: Schema.Literal('root'), children, ...at });
