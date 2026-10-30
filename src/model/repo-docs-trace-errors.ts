import { Data } from "effect";

export class TraceRecoveryRequired extends Data.TaggedError("TraceRecoveryRequired")<{
  readonly path: string;
  readonly nextStep: "pnpm trace recover" | "concord recover";
}> {}

export class TraceRecoveryConflict extends Data.TaggedError("TraceRecoveryConflict")<{
  readonly path: string;
  readonly message: string;
}> {}
