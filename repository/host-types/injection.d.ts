import { Effect } from "effect";
import * as FileSystem from "effect/FileSystem";
export interface CandidateTarball {
    readonly path: string;
    readonly integrity: string;
    readonly shortHash: string;
    readonly sha256: string;
    readonly name: string;
    readonly version: string;
}
declare const CandidatePackError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "CandidatePackError";
} & Readonly<A>;
export declare class CandidatePackError extends CandidatePackError_base<{
    readonly operation: "prepare" | "pack" | "fingerprint";
    readonly detail: string;
}> {
}
/** Recomputes candidate identity from bytes; the operation never invokes pnpm. */
export declare function readCandidateTarball(path: string): Effect.Effect<CandidateTarball, CandidatePackError, FileSystem.FileSystem>;
/** Builds one candidate while the Scope owns both the pack lease and command group. */
export declare function buildCandidateTarball(repoRoot: string, destination: string, options?: {
    readonly quiet?: boolean;
}): Effect.Effect<CandidateTarball, CandidatePackError, import("effect").Scope.Scope | import("./owned-process.ts").OwnedProcess | FileSystem.FileSystem>;
export declare function extractNiceevalIntegrity(lockfileText: string): string;
export type InjectionVerdict = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly reason: string;
};
export declare function verifyInjection(lockfileText: string, expectedIntegrity: string): InjectionVerdict;
export {};
