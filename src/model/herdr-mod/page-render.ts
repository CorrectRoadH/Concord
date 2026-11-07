// @concord-file
// @concord-implements docs/feature/herdr-mod/cli.md#渲染一页
import { Schema } from 'effect';

const Digest = Schema.String.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/u));
export const PageTheme = Schema.Record(Schema.String, Schema.String.check(Schema.isMaxLength(256)));
const Markdown = Schema.Struct({ type: Schema.Literal('markdown'), text: Schema.String });
const ImageFields = { type: Schema.Literal('image'), source: Schema.String, alt: Schema.String };
const MermaidFields = { type: Schema.Literal('mermaid'), source: Schema.String };
const P5Fields = { type: Schema.Literal('p5'), source: Schema.String, description: Schema.String };
export const RenderBlock = Schema.Union([
  Markdown,
  Schema.Struct({ ...ImageFields, mediaType: Schema.Literals(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']), data: Schema.String, digest: Digest }),
  Schema.Struct({ ...ImageFields, error: Schema.String }),
  Schema.Struct({ ...MermaidFields, svg: Schema.String, digest: Digest }),
  Schema.Struct({ ...MermaidFields, error: Schema.String }),
  Schema.Struct({ ...P5Fields, html: Schema.String }),
  Schema.Struct({ ...P5Fields, error: Schema.String }),
]);
export type RenderBlock = typeof RenderBlock.Type;
export const RenderedPage = Schema.Struct({ path: Schema.String, blocks: Schema.Array(RenderBlock) });
export type RenderedPage = typeof RenderedPage.Type;
