import * as FileSystem from "effect/FileSystem";
import { Effect, Scope } from "effect";
import { type DiscoveredRepo } from "./discovery.ts";
import type { CandidateTarball } from "./injection.ts";
import { type OwnedProcess, type OwnedProcessResult } from "./owned-process.ts";
import { type TestkitPackage } from "./testkit-snapshot.ts";
import { type Category, type CommandCapture, type RepoReceipt, type SelectionReceipt } from "./receipt.ts";
export interface RepoRunResult {
    readonly id: string;
    readonly exitCode: number | null;
    readonly category: Category;
    readonly detail: string;
    readonly attempts: number;
    readonly receipt: RepoReceipt;
    readonly artifactDir: string;
    readonly receiptPath: string;
}
declare const RepoRunError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "RepoRunError";
} & Readonly<A>;
export declare class RepoRunError extends RepoRunError_base<{
    readonly repoId: string;
    readonly operation: "candidate" | "command" | "run";
    readonly detail: string;
}> {
}
export declare const appendNativeArgs: (command: readonly string[], nativeArgs: readonly string[]) => readonly string[];
export declare const E2E_COPY_EXCLUDED_BASENAMES: Set<string>;
export declare const materializeCandidateArtifact: (artifactRoot: string, candidate: CandidateTarball) => Effect.Effect<string, RepoRunError, FileSystem.FileSystem>;
/** Copy only permitted source entries; excluded names are never read or copied. */
export declare const copyRepoIsolated: (source: string, destination: string) => Effect.Effect<void, RepoRunError, FileSystem.FileSystem>;
export declare const pointAtCandidateTarball: (copyDir: string, tarball: string) => Effect.Effect<void, RepoRunError, FileSystem.FileSystem>;
export declare const captureOwnedProcess: (result: OwnedProcessResult) => CommandCapture;
export declare const runCommand: (command: readonly string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number, prefix?: string) => Effect.Effect<CommandCapture, RepoRunError, OwnedProcess | Scope.Scope>;
export interface RunRepoOptions {
    readonly sourceDir?: string;
    readonly runLabel?: string;
    readonly workdirKey?: string;
    readonly testRuns?: number;
    readonly copyId?: string;
    readonly sourceSnapshotDigest?: string;
    readonly keepWorkdir?: boolean;
    readonly logPrefix?: string;
    readonly selection?: SelectionReceipt;
}
export declare const commandCaptureOk: (value: CommandCapture) => boolean;
export declare const withInvocation: (env: NodeJS.ProcessEnv, id: string, copy: string, harnessEnvironment?: Readonly<Record<string, string>>, artifactStagingRoot?: string) => NodeJS.ProcessEnv;
export declare const runRepoEffect: (repo: DiscoveredRepo, candidate: CandidateTarball, scratchRoot: string, artifactRoot: string, allSecretNames: ReadonlySet<string>, nativeArgs: readonly string[], testkit?: TestkitPackage, options?: RunRepoOptions) => Effect.Effect<RepoRunResult, RepoRunError, FileSystem.FileSystem | OwnedProcess | Scope.Scope>;
export {};
