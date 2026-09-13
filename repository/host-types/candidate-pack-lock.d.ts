import * as FileSystem from "effect/FileSystem";
import { Effect, Scope } from "effect";
export interface CandidatePackLock {
    readonly path: string;
}
declare const CandidatePackLockError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "CandidatePackLockError";
} & Readonly<A>;
export declare class CandidatePackLockError extends CandidatePackLockError_base<{
    readonly operation: "acquire" | "inspect" | "release";
    readonly detail: string;
}> {
}
export declare function acquireCandidatePackLock(repoRoot: string): Effect.Effect<CandidatePackLock, CandidatePackLockError, FileSystem.FileSystem | Scope.Scope>;
export {};
