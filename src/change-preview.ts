// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/review-pull-request.md
import { Schema } from 'effect';

export const PREVIEW_DATA_LIMIT = 8 * 1024 * 1024;
export const PREVIEW_ENTRY_LIMIT = 2000;
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const Oid = Schema.String.check(Schema.isPattern(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u));
const Path = Schema.String.check(Schema.makeFilter(value => value.length > 0 && !value.startsWith('/') && !value.includes('\0')
  && value.split('/').every(part => part !== '' && part !== '.' && part !== '..')
  && new TextDecoder().decode(new TextEncoder().encode(value)) === value));
const Markdown = Schema.String.check(Schema.makeFilter(value => bytes(value) <= 1024 * 1024));
const Side = Schema.Struct({ oid: Oid, mode: Schema.Literals(['100644', '100755', '120000', '160000']) });
export type PreviewSide = typeof Side.Type;
export const ChangePreviewEntrySchema = Schema.Struct({
  path: Path,
  previousPath: Schema.optional(Path),
  status: Schema.Literals(['A', 'D', 'M', 'R', 'T']),
  before: Schema.NullOr(Side),
  after: Schema.NullOr(Side),
  patch: Schema.String.check(Schema.makeFilter(value => bytes(value) <= 2 * 1024 * 1024)),
  binary: Schema.Boolean,
  beforeMarkdown: Schema.optional(Markdown),
  afterMarkdown: Schema.optional(Markdown),
}).check(Schema.makeFilter(entry => {
  if ((entry.status === 'R') !== (entry.previousPath !== undefined) || entry.previousPath === entry.path) return false;
  if (entry.status === 'A' ? entry.before !== null || entry.after === null
    : entry.status === 'D' ? entry.before === null || entry.after !== null : entry.before === null || entry.after === null) return false;
  if (entry.binary && (entry.patch !== '' || entry.beforeMarkdown !== undefined || entry.afterMarkdown !== undefined)) return false;
  const applicable = (side: PreviewSide | null, path: string) => !!side && /^(100644|100755)$/u.test(side.mode) && /\.(md|markdown)$/iu.test(path);
  return (entry.beforeMarkdown === undefined || applicable(entry.before, entry.previousPath ?? entry.path))
    && (entry.afterMarkdown === undefined || applicable(entry.after, entry.path));
}));
export const ChangePreviewSchema = Schema.Struct({
  format: Schema.Literal('concord.change-preview/v1'),
  comparison: Schema.Struct({
    base: Oid, head: Oid, mergeBase: Oid,
    baseLabel: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  }),
  entries: Schema.Array(ChangePreviewEntrySchema).check(Schema.isMaxLength(PREVIEW_ENTRY_LIMIT)),
}).check(Schema.makeFilter(value => {
  const length = value.comparison.base.length;
  return value.comparison.head.length === length && value.comparison.mergeBase.length === length
    && new Set(value.entries.map(entry => entry.path)).size === value.entries.length
    && value.entries.every(entry => [entry.before, entry.after].every(side => side === null || side.oid.length === length))
    && bytes(JSON.stringify(value)) <= PREVIEW_DATA_LIMIT;
}));
export type ChangePreview = typeof ChangePreviewSchema.Type;
export type ChangePreviewEntry = typeof ChangePreviewEntrySchema.Type;
/** Shared strict boundary for the browser, installed consumers and the exporter. */
export const decodeChangePreview = Schema.decodeUnknownSync(ChangePreviewSchema, { onExcessProperty: 'error' });
