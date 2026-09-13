import * as Cause from "effect/Cause";
/** Preserve Effect v4 Cause structure while making detail-only tagged errors readable. */
export declare const formatCause: <E>(cause: Cause.Cause<E>) => string;
