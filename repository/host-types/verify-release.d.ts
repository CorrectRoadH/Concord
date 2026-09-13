import * as FileSystem from "effect/FileSystem";
import { Effect } from "effect";
export interface VerifyReleaseOptions {
    readonly planPath: string;
    readonly candidatePath: string;
    readonly receiptRoot: string;
    readonly tag: string;
}
declare const VerifyReleaseOperationError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "VerifyReleaseOperationError";
} & Readonly<A>;
export declare class VerifyReleaseOperationError extends VerifyReleaseOperationError_base<{
    readonly operation: "plan" | "candidate" | "receipts" | "tarball";
    readonly detail: string;
}> {
}
export interface ReleaseVerification {
    readonly ok: true;
    readonly planRepoIds: readonly string[];
    readonly receiptRepoIds: readonly string[];
    readonly candidate: {
        readonly name: string;
        readonly version: string;
        readonly sha256: string;
        readonly integrity: string;
    };
    readonly tag: string;
}
/** Verifies plan, receipts and candidate bytes without release side effects. */
export declare const verifyRelease: (options: VerifyReleaseOptions) => Effect.Effect<ReleaseVerification, VerifyReleaseOperationError, FileSystem.FileSystem>;
export {};
