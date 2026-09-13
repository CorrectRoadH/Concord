import { Effect } from "effect";
import * as FileSystem from "effect/FileSystem";
import { type CandidateTarball } from "./injection.ts";
declare const PackCandidateError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "PackCandidateError";
} & Readonly<A>;
export declare class PackCandidateError extends PackCandidateError_base<{
    readonly operation: "prepare-output" | "move" | "fingerprint";
    readonly detail: string;
}> {
}
/** Creates exactly one requested .tgz; its temporary directory is scope-owned. */
export declare function packCandidate(repoRoot: string, out: string): Effect.Effect<CandidateTarball, PackCandidateError, import("./owned-process.ts").OwnedProcess | FileSystem.FileSystem>;
export {};
