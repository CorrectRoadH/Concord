import { Data } from "effect";

export class IssueInputError extends Data.TaggedError("IssueInputError")<{ readonly message: string }> {}
export class IssueRemoteError extends Data.TaggedError("IssueRemoteError")<{
  readonly operation: string;
  readonly message: string;
  readonly uncertain: boolean;
}> {}
export class IssuePlanExpired extends Data.TaggedError("IssuePlanExpired")<{ readonly receiptId: string }> {}
export class IssuePlanConsumed extends Data.TaggedError("IssuePlanConsumed")<{ readonly receiptId: string }> {}
export class IssuePlanNotPlanned extends Data.TaggedError("IssuePlanNotPlanned")<{ readonly receiptId: string }> {}
export class IssuePlanCorrupt extends Data.TaggedError("IssuePlanCorrupt")<{ readonly receiptId: string; readonly message: string }> {}
export class IssuePlanIoError extends Data.TaggedError("IssuePlanIoError")<{
  readonly operation: "plan" | "consume" | "read" | "outcome";
  readonly path: string;
  readonly message: string;
}> {}
export class IssuePlanDrifted extends Data.TaggedError("IssuePlanDrifted")<{
  readonly receiptId: string;
  readonly expected: string;
  readonly actual: string;
}> {}
export class IssueCreateConflict extends Data.TaggedError("IssueCreateConflict")<{ readonly message: string }> {}
export type IssueError = IssueGhError | IssueRemoteTransportUnsupported | IssueConnectionUnbound | ConnectionIdentityMismatch | IssueTargetIsPullRequest | IssueNoChange | IssueAuthorizationMismatch | IssueRemoteBudgetExceeded | IssueRemoteRejected | IssueMutationUncertain | IssueInputError | IssueRemoteError | IssuePlanExpired | IssuePlanConsumed | IssuePlanNotPlanned | IssuePlanCorrupt | IssuePlanIoError | IssuePlanDrifted | IssueCreateConflict;
export class IssueRemoteTransportUnsupported extends Data.TaggedError("IssueRemoteTransportUnsupported")<{ readonly message: string }> {}
export class IssueConnectionUnbound extends Data.TaggedError("IssueConnectionUnbound")<{ readonly message: string }> {}
export class ConnectionIdentityMismatch extends Data.TaggedError("ConnectionIdentityMismatch")<{ readonly message: string }> {}
export class IssueTargetIsPullRequest extends Data.TaggedError("IssueTargetIsPullRequest")<{ readonly message: string }> {}
export class IssueNoChange extends Data.TaggedError("IssueNoChange")<{ readonly message: string }> {}
export class IssueAuthorizationMismatch extends Data.TaggedError("IssueAuthorizationMismatch")<{ readonly message: string }> {}
export class IssueRemoteBudgetExceeded extends Data.TaggedError("IssueRemoteBudgetExceeded")<{ readonly message: string }> {}
export class IssueRemoteRejected extends Data.TaggedError("IssueRemoteRejected")<{ readonly message: string; readonly details: { readonly status: number } }> {}
export class IssueMutationUncertain extends Data.TaggedError("IssueMutationUncertain")<{ readonly message: string; readonly details: { readonly receiptId: string; readonly issueOperation: string; readonly target: string; readonly method: string; readonly path: string } }> {}

export interface IssueGhError { readonly code: string; readonly message: string; readonly details?: Readonly<Record<string, unknown>> }
