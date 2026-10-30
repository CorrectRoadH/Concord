import { Data } from "effect";
import { TraceRecoveryConflict, TraceRecoveryRequired } from "./repo-docs-trace-errors.js";

export class TraceMutationError extends Data.TaggedError("TraceMutationError")<{
  readonly operation: string;
  readonly phase:
    | "git-private"
    | "read"
    | "lock"
    | "preimage"
    | "publish"
    | "generation"
    | "rollback"
    | "journal"
    | "cleanup"
    | "capacity";
  readonly path?: string;
  readonly message: string;
}> {}
export type TraceCoordinationError = TraceMutationError | TraceRecoveryRequired | TraceRecoveryConflict;
