import { Schema } from "effect";
const RepositorySchema = Schema.Struct({ host: Schema.Literal("github.com"), repository: Schema.String });
const NumberSchema = Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER));
export const IssuePayloadSchema = Schema.Union([
  Schema.Struct({ operation: Schema.Literal("create"), title: Schema.String, body: Schema.String }),
  Schema.Struct({ operation: Schema.Literal("body-set"), body: Schema.String }),
  Schema.Struct({ operation: Schema.Literal("comment-add"), body: Schema.String }),
  Schema.Struct({ operation: Schema.Literal("labels-add"), labels: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(50), Schema.isPattern(/^[^\u0000-\u001f\u007f]+$/u))).check(Schema.isMinLength(1)) }),
  Schema.Struct({ operation: Schema.Literal("labels-remove"), labels: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(50), Schema.isPattern(/^[^\u0000-\u001f\u007f]+$/u))).check(Schema.isLengthBetween(1, 1)) }),
  Schema.Struct({ operation: Schema.Literal("close"), reason: Schema.optional(Schema.Literals(["completed", "not_planned"])) }),
  Schema.Struct({ operation: Schema.Literal("reopen") }),
]);
export const IssueIdentitySchema = Schema.Struct({ ...RepositorySchema.fields, number: NumberSchema });
export const CreateIdentitySchema = Schema.Struct({ ...RepositorySchema.fields, kind: Schema.Literals(["machine-origin", "manual"]), originKey: Schema.optional(Schema.String) });
export const IssuePlanReceiptSchema = Schema.Struct({
  format: Schema.Literal("concord.issue-plan/v1"), id: Schema.String.check(Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u)), schema: Schema.Literal(1),
  plannedAt: Schema.Number, expiresAt: Schema.Number,
  connection: Schema.String, repositoryId: Schema.String.check(Schema.isPattern(/^[1-9][0-9]*$/u)),
  operation: Schema.Literals(["create", "body-set", "labels-add", "labels-remove", "comment-add", "close", "reopen"]),
  repository: RepositorySchema, identity: Schema.Union([IssueIdentitySchema, CreateIdentitySchema]),
  remotePreimageDigest: Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/u)),
  payloadDigest: Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/u)), payload: IssuePayloadSchema,
});
export type IssueRepository = typeof RepositorySchema.Type;
export type IssueIdentity = typeof IssueIdentitySchema.Type;
export type CreateIdentity = typeof CreateIdentitySchema.Type;
export type IssuePayload = typeof IssuePayloadSchema.Type;
export type IssueOperation = IssuePayload["operation"];
export type IssuePlanReceipt = typeof IssuePlanReceiptSchema.Type;
export interface RemoteIssue extends IssueIdentity {
  readonly url: string; readonly title: string; readonly body: string; readonly state: "open" | "closed"; readonly labels: readonly string[]; readonly isPullRequest: boolean;
}
export interface IssueMutationResult { readonly issue: RemoteIssue }
export interface IssueBinding { readonly connection: string; readonly repositoryId: string; readonly repository: IssueRepository }
export interface IssueOutcome {
  readonly state: "applied" | "drifted" | "aborted" | "rejected" | "uncertain";
  readonly receiptId: string; readonly issueOperation: IssueOperation; readonly target: string;
  readonly code?: string; readonly status?: number;
}
