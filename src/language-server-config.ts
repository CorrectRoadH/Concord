// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/analyze-other-languages.md
import { Schema } from 'effect';

const text = Schema.String.check(Schema.isMinLength(1));
const path = text.check(Schema.makeFilter(value => value.trim() === value && !/^[\/]|[\\\0\r\n#]/u.test(value) && value.split('/').every(part => !['.', '..', '', '.git'].includes(part))));
const bounded = (maximum: number) => Schema.Int.check(Schema.isBetween({ minimum: 1, maximum }));

/** Package ceilings apply even when a consumer omits its own budgets. */
export const ANALYSIS_LIMITS = {
  totalMs: 120000, requestMs: 10000, outputBytes: 8 * 1024 * 1024,
  messageBytes: 1024 * 1024, messages: 20000, requests: 2000,
  concurrency: 8, files: 1000, symbols: 20000, nodes: 2000, depth: 32,
} as const;
export const AnalysisBudgetsSchema = Schema.Struct({
  totalMs: Schema.optional(bounded(ANALYSIS_LIMITS.totalMs)),
  requestMs: Schema.optional(bounded(ANALYSIS_LIMITS.requestMs)),
  outputBytes: Schema.optional(bounded(ANALYSIS_LIMITS.outputBytes)),
  messageBytes: Schema.optional(bounded(ANALYSIS_LIMITS.messageBytes)),
  messages: Schema.optional(bounded(ANALYSIS_LIMITS.messages)),
  requests: Schema.optional(bounded(ANALYSIS_LIMITS.requests)),
  concurrency: Schema.optional(bounded(ANALYSIS_LIMITS.concurrency)),
  files: Schema.optional(bounded(ANALYSIS_LIMITS.files)),
  symbols: Schema.optional(bounded(ANALYSIS_LIMITS.symbols)),
  nodes: Schema.optional(bounded(ANALYSIS_LIMITS.nodes)),
  depth: Schema.optional(bounded(ANALYSIS_LIMITS.depth)),
});
export const LanguageProfileSchema = Schema.Struct({
  version: text,
  serverVersion: text,
  commentPrefixes: Schema.NonEmptyArray(Schema.Literals(['#', '//', '--', ';'])),
  declarationKinds: Schema.NonEmptyArray(bounded(26)),
  symbolShape: Schema.Literal('document-symbol'),
  decorators: Schema.Literals(['none', 'at-line']),
  leadingComments: Schema.Boolean,
  readiness: Schema.Union([
    Schema.Struct({ kind: Schema.Literal('none') }),
    Schema.Struct({ kind: Schema.Literal('progress'), token: text }),
  ]),
  positionEncodings: Schema.NonEmptyArray(Schema.Literals(['utf-16', 'utf-8', 'utf-32'])),
});
export const LanguageServerSchema = Schema.Struct({
  id: text.check(Schema.makeFilter(value => value !== 'typescript')), languageId: text,
  extensions: Schema.NonEmptyArray(text.check(Schema.makeFilter(value => /^\.[a-zA-Z0-9][a-zA-Z0-9.]*$/u.test(value) && !/\.(?:[cm]?[jt]sx?)$/iu.test(value)))),
  profile: LanguageProfileSchema,
  argv: Schema.NonEmptyArray(text), cwd: Schema.Union([Schema.Literal('.'), path]),
  initializationOptions: Schema.Record(text, Schema.Unknown),
  implementationFiles: Schema.NonEmptyArray(path), sourceFiles: Schema.Array(path),
  budgets: AnalysisBudgetsSchema,
  environment: Schema.optional(Schema.Array(Schema.Literals(['PATH', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'SYSTEMROOT']))),
});
export type LanguageServer = typeof LanguageServerSchema.Type;
export type AnalysisBudgets = { readonly [K in keyof typeof ANALYSIS_LIMITS]: number };
export function analysisBudgets(server?: LanguageServer): AnalysisBudgets {
  return { ...ANALYSIS_LIMITS, depth: 3, ...server?.budgets };
}
export const LanguageServersSchema = Schema.Array(LanguageServerSchema).check(Schema.makeFilter(values => {
  const ids = values.map(item => item.id);
  const extensions = values.flatMap(item => item.extensions);
  return new Set(ids).size === ids.length && extensions.every((extension, index) => !extensions.some((other, otherIndex) => index !== otherIndex && (extension.endsWith(other) || other.endsWith(extension))));
}, { description: 'unique server IDs and nonoverlapping extension suffixes' }));
