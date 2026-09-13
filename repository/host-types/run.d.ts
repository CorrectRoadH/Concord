import * as FileSystem from "effect/FileSystem";
import { Effect, Scope } from "effect";
import * as Cause from "effect/Cause";
import { type RepoRunResult } from "./run-repo.ts";
import type { Category, SelectionReceipt } from "./receipt.ts";
import type { OwnedProcess } from "./owned-process.ts";
export { appendNativeArgs } from "./run-repo.ts";
export type { RepoRunResult } from "./run-repo.ts";
declare const E2ERunError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => Cause.YieldableError & {
    readonly _tag: "E2ERunError";
} & Readonly<A>;
export declare class E2ERunError extends E2ERunError_base<{
    readonly detail: string;
}> {
}
export interface RunOptions {
    readonly repoIds: readonly string[];
    readonly lane?: import("./contracts.ts").Lane;
    readonly capability?: string;
    readonly candidatePath: string;
    readonly artifactRoot?: string;
    readonly nativeArgs: readonly string[];
    readonly keepWorkdir: boolean;
    readonly repoConcurrency: number;
    readonly selection?: SelectionReceipt;
}
export type ScratchDisposition = {
    readonly kind: "not-created";
    readonly ok: true;
    readonly detail: string;
} | {
    readonly kind: "removed" | "retained";
    readonly ok: true;
    readonly path: string;
    readonly detail: string;
} | {
    readonly kind: "remove-failed";
    readonly ok: false;
    readonly path: string;
    readonly detail: string;
};
export interface RunnerTerminalSummary {
    readonly category: "pass" | "infra";
    readonly detail: string;
    readonly scratchDisposition: ScratchDisposition;
}
export interface RunSummary {
    readonly artifactRoot: string;
    readonly summaryPath: string;
    readonly results: readonly {
        readonly id: string;
        readonly exitCode: number | null;
        readonly category: Category;
        readonly detail: string;
        readonly artifactDir: string;
        readonly receiptPath: string;
    }[];
    readonly passed: number;
    readonly regression: number;
    readonly infra: number;
    readonly configuration: number;
    readonly cancelled: number;
    readonly total: number;
    readonly category: Category;
    readonly detail: string;
    readonly runner: RunnerTerminalSummary;
    readonly selection?: SelectionReceipt;
}
export declare const buildSummary: (artifactRoot: string, results: readonly RepoRunResult[], runner: RunnerTerminalSummary, selection?: SelectionReceipt) => RunSummary;
export declare const runEffect: (options: RunOptions) => Effect.Effect<RunSummary, E2ERunError, FileSystem.FileSystem | OwnedProcess | Scope.Scope>;
