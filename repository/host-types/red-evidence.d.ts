import * as FileSystem from "effect/FileSystem";
import { Effect } from "effect";
import { type RepoReceipt } from "./contracts.ts";
import { OwnedProcess } from "./owned-process.ts";
import { type FormalCaseReceiptV2 } from "./case-evidence.ts";
export interface RedEvidenceOptions {
    readonly candidatePath: string;
    readonly candidateGitSha: string;
    readonly repoId: string;
    readonly selector: string;
    readonly inventoryId: string;
    readonly artifactRoot?: string;
    readonly nativeArgs: readonly string[];
}
export interface RedEvidenceSummary {
    readonly format: "niceeval.e2e-red-evidence-summary/v1";
    readonly evidence: string;
    readonly receiptPath: string;
    readonly receipt: FormalCaseReceiptV2;
}
declare const RedEvidenceError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "RedEvidenceError";
} & Readonly<A>;
export declare class RedEvidenceError extends RedEvidenceError_base<{
    readonly detail: string;
}> {
}
export declare const validateExpectedRegression: (receipt: RepoReceipt) => {
    readonly test: NonNullable<RepoReceipt["stages"][number]["capture"]>;
    readonly invocationId: string;
    readonly resources: readonly object[];
};
export declare const runRedEvidence: (options: RedEvidenceOptions) => Effect.Effect<RedEvidenceSummary, RedEvidenceError, FileSystem.FileSystem | OwnedProcess | import("effect").Scope.Scope>;
export {};
