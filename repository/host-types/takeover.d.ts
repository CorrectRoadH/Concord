import * as FileSystem from "effect/FileSystem";
import { Effect } from "effect";
import { type DiscoveredRepo } from "./discovery.ts";
import { type CandidateTarball } from "./injection.ts";
import { OwnedProcess } from "./owned-process.ts";
import { type RepoRunResult } from "./run-repo.ts";
import { type TestkitPackage } from "./testkit-snapshot.ts";
import { type TakeoverCertificateV1 } from "./case-evidence.ts";
export interface TakeoverOptions {
    readonly candidatePath: string;
    readonly repoId: string;
    readonly artifactRoot?: string;
    readonly nativeArgs: readonly string[];
    readonly selector: string;
    readonly inventoryId: string;
}
declare const TakeoverOperationError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "TakeoverOperationError";
} & Readonly<A>;
export declare class TakeoverOperationError extends TakeoverOperationError_base<{
    readonly operation: "candidate" | "discovery" | "checkout" | "snapshot" | "artifact" | "cleanup" | "evidence";
    readonly detail: string;
}> {
}
interface SourceSnapshotFile {
    readonly path: string;
    readonly bytes: number;
    readonly sha256: string;
}
interface SourceSnapshotIdentity {
    readonly algorithm: "sha256";
    readonly digest: string;
    readonly files: readonly SourceSnapshotFile[];
}
interface CheckoutIdentity {
    readonly root: string;
    readonly commit: string;
    readonly dirty: boolean;
    readonly sourceSnapshot?: SourceSnapshotIdentity;
}
export interface TakeoverRunRecord {
    readonly label: string;
    readonly mode: "isolated-copy" | "same-installed-copy" | "repo-default-parallel" | "target-single";
    readonly copyId?: string;
    readonly sourceSnapshotDigest?: string;
    readonly receiptPath: string;
    readonly artifactDir: string;
    readonly category: RepoRunResult["category"];
    readonly detail: string;
    readonly testInvocations: number;
    readonly invocationIds: readonly string[];
    readonly testAttemptInvocationIds: readonly {
        readonly attempt: number;
        readonly invocationId: string;
    }[];
    readonly cleanupOk: boolean;
}
export interface TakeoverSummary {
    readonly repoId: string;
    readonly candidate: Pick<CandidateTarball, "sha256" | "integrity">;
    readonly checkout: CheckoutIdentity;
    readonly testkit?: Pick<TestkitPackage, "name" | "version" | "sourcePath">;
    readonly targetNativeArgs: readonly string[];
    readonly noRetry: true;
    readonly runs: readonly TakeoverRunRecord[];
    readonly matrixValidation: {
        readonly ok: boolean;
        readonly complete: boolean;
        readonly issues: readonly string[];
    };
    readonly category: RepoRunResult["category"];
    readonly detail: string;
    readonly sourceSnapshotCleanup: {
        readonly ok: boolean;
        readonly detail: string;
    };
    readonly certificate?: TakeoverCertificateV1;
    readonly certificatePath?: string;
    readonly evidence?: string;
}
type TakeoverRequirements = FileSystem.FileSystem | OwnedProcess;
export declare const assertSnapshotTreeSafe: (root: string) => Effect.Effect<void, TakeoverOperationError, FileSystem.FileSystem>;
export declare const fingerprintSourceSnapshot: (snapshotDir: string) => Effect.Effect<SourceSnapshotIdentity, TakeoverOperationError, FileSystem.FileSystem>;
/** Pure business validation: defects remain durable matrix findings, not operational failures. */
export declare const validateTakeoverMatrix: (results: readonly RepoRunResult[], repo: DiscoveredRepo, candidate: CandidateTarball, targetNativeArgs: readonly string[], cancelled: boolean, sourceSnapshotCleanup: {
    readonly ok: boolean;
}, checkout: CheckoutIdentity | undefined) => {
    ok: boolean;
    complete: boolean;
    issues: string[];
};
/** One Effect program shares candidate, fixed source snapshot and optional Testkit across all six observations. */
export declare const runTakeover: (options: TakeoverOptions) => Effect.Effect<TakeoverSummary, TakeoverOperationError, TakeoverRequirements>;
export {};
