import { Schema } from "effect";
import { ResearchSchema, type DocumentMeta } from "concord-sdlc/model";

const NonEmptyTrimmedString = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1));

export const RESEARCH_FORMAT = "concord.document/v1" as const;
export const RESEARCH_MARKER = "<!-- concord-research: v1 -->" as const;

// Path safety is enforced again by publication against the real filesystem;
// this schema intentionally permits Unicode topic and page names.
const SafeRelativePath = Schema.String.check(Schema.isPattern(/^[^/\\\0\r\n]+(?:\/[^/\\\0\r\n]+)*$/u));
export const ResearchPathSchema = SafeRelativePath;
export const ResearchPageSchema = SafeRelativePath;
export const ResearchRefSchema = Schema.String.check(Schema.isPattern(/^research:docs\/research\/.+\.md$/u));
export const ResearchUrlSchema = Schema.String.check(Schema.isPattern(/^https?:\/\/\S+$/u));

export const ResearchContentSchema = Schema.Struct({
  title: NonEmptyTrimmedString,
  body: Schema.optional(Schema.String),
  observedAt: Schema.optional(NonEmptyTrimmedString),
  sources: Schema.optional(Schema.Array(NonEmptyTrimmedString)),
});
export type ResearchContent = typeof ResearchContentSchema.Type;

export const ResearchCreatePageInputSchema = Schema.Struct({
  command: Schema.Literal("create-page"),
});
export type ResearchCreatePageInput = typeof ResearchCreatePageInputSchema.Type;

export const ResearchCreatePackageInputSchema = Schema.Struct({
  command: Schema.Literal("create-package"),
  path: ResearchPathSchema,
  content: ResearchContentSchema,
  dryRun: Schema.Boolean,
});
export type ResearchCreatePackageInput = typeof ResearchCreatePackageInputSchema.Type;

export const ResearchAddPageInputSchema = Schema.Struct({
  command: Schema.Literal("add-page"),
  parent: ResearchRefSchema,
  page: ResearchPageSchema,
  content: ResearchContentSchema,
  dryRun: Schema.Boolean,
});
export type ResearchAddPageInput = typeof ResearchAddPageInputSchema.Type;

export const ResearchCheckInputSchema = Schema.Struct({
  command: Schema.Literal("check"),
  ref: ResearchRefSchema,
});
export type ResearchCheckInput = typeof ResearchCheckInputSchema.Type;

export const ResearchCommandInputSchema = Schema.Union([
  ResearchCreatePageInputSchema,
  ResearchCreatePackageInputSchema,
  ResearchAddPageInputSchema,
  ResearchCheckInputSchema,
]);
export type ResearchCommandInput = typeof ResearchCommandInputSchema.Type;

export const ResearchFrontmatterSchema = ResearchSchema;
export type ResearchFrontmatter = Extract<DocumentMeta, { readonly kind: "research" }>;

export interface ResearchMutationReceipt {
  readonly format: "concord.docs-research/receipt/v1";
  readonly command: "create-page" | "create-package" | "add-page";
  readonly dryRun: boolean;
  readonly ref: string;
  readonly target: string;
  readonly changedPaths: readonly string[];
  readonly preimage: { readonly kind: "absent" };
  readonly contentDigest: string;
  readonly summary: string;
}

export interface ResearchCheckFinding {
  readonly path: string;
  readonly code:
    | "unmanaged"
    | "invalid-document"
    | "research-migration-required"
    | "nested-owner"
    | "invalid-package-root";
  readonly message: string;
}

export interface ResearchCheckReceipt {
  readonly format: "concord.docs-research/check/v1";
  readonly command: "check";
  readonly ok: boolean;
  readonly ref: string;
  readonly target: string;
  readonly checkedPaths: readonly string[];
  readonly findings: readonly ResearchCheckFinding[];
  readonly summary: string;
}

export type ResearchOutcome = ResearchMutationReceipt | ResearchCheckReceipt;
