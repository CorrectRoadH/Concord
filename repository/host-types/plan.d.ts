import * as FileSystem from "effect/FileSystem";
import { Effect, Result } from "effect";
import { type ContractDecodeError, type InvalidPlanOutput, type Lane, type PlanDocument as ContractPlanDocument, type PlanEntry as ContractPlanEntry } from "./contracts.ts";
import { type DiscoveredRepo, type DiscoveryIoError } from "./discovery.ts";
import { type OwnedProcess } from "./owned-process.ts";
export interface SelectionOptions {
    readonly lane?: Lane;
    readonly repoIds?: readonly string[];
    readonly capability?: string;
    readonly excludeExternalNetwork?: boolean;
    readonly affectedProjectNames?: readonly string[];
}
export type PlanEntry = ContractPlanEntry;
export type PlanDocument = ContractPlanDocument;
export type PlanMode = PlanDocument["mode"] | "invalid";
/** Parsed CLI facts are supplied by the command-program lane. */
export interface PlanCli {
    readonly lane: Lane;
    readonly repoIds: readonly string[];
    readonly diffPaths?: readonly string[];
    readonly noDiff: boolean;
    readonly base?: string;
    readonly head?: string;
    readonly capability?: string;
    readonly excludeExternalNetwork: boolean;
    readonly batch: boolean;
    readonly json: boolean;
}
export interface ResolvedPlan {
    readonly cli: PlanCli;
    readonly entries: readonly PlanEntry[];
    readonly document: PlanDocument;
}
declare const PlanSelectionError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "PlanSelectionError";
} & Readonly<A>;
export declare class PlanSelectionError extends PlanSelectionError_base<{
    readonly reason: string;
    readonly detail: string;
}> {
}
declare const PlanProcessError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "PlanProcessError";
} & Readonly<A>;
export declare class PlanProcessError extends PlanProcessError_base<{
    readonly command: string;
    readonly args: readonly string[];
    readonly cwd: string;
    readonly stderr: string;
    readonly detail: string;
    readonly cause: unknown;
}> {
}
declare const PlanFilesystemError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "PlanFilesystemError";
} & Readonly<A>;
export declare class PlanFilesystemError extends PlanFilesystemError_base<{
    readonly operation: "exists" | "read-file" | "temporary-directory";
    readonly path: string;
    readonly cause: unknown;
}> {
}
declare const PlanJsonError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "PlanJsonError";
} & Readonly<A>;
export declare class PlanJsonError extends PlanJsonError_base<{
    readonly source: string;
    readonly cause: unknown;
}> {
}
/** Pure selection: explicit selection always retains its validation semantics. */
export declare const selectRepos: (all: readonly DiscoveredRepo[], options: SelectionOptions) => Result.Result<readonly DiscoveredRepo[], PlanSelectionError>;
/** Pure batching preserves exactly the selected repo-id set. */
export declare const batchEntries: (entries: readonly PlanEntry[]) => Result.Result<readonly PlanEntry[], PlanSelectionError>;
type PlanFailure = DiscoveryIoError | PlanSelectionError | PlanProcessError | PlanFilesystemError | PlanJsonError | ContractDecodeError;
/**
 * Effect-native planning composition. The command layer parses argv and owns
 * output/runtime closing; this function owns discovery, Git/Nx I/O and plan
 * construction only.
 */
export declare const resolvePlan: (cli: PlanCli) => Effect.Effect<ResolvedPlan, PlanFailure, FileSystem.FileSystem | OwnedProcess>;
export declare const invalidPlanOutput: (detail: string) => InvalidPlanOutput;
/** Rendering is pure; the command handler owns its output capability. */
export declare const formatResolvedPlan: (plan: ResolvedPlan) => readonly string[];
export {};
