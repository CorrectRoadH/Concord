import * as FileSystem from "effect/FileSystem";
import { Effect, Scope } from "effect";
import { type CandidateIdentity, type CommandCapture } from "./contracts.ts";
import type { OwnedProcess } from "./owned-process.ts";
export type DiagnosticMode = "test" | "exec";
export interface DiagnoseOptions {
    readonly mode: DiagnosticMode;
    readonly summaryPath: string;
    readonly repoId: string;
    readonly timeoutSeconds: number;
    readonly argv: readonly string[];
}
export interface FreshCopyCleanup {
    readonly kind: "not-created" | "removed" | "remove-failed";
    readonly ok: boolean;
    readonly path?: string;
    readonly detail: string;
}
export interface DiagnosticSummary {
    readonly diagnostic: true;
    readonly mode: DiagnosticMode;
    readonly ok: boolean;
    readonly detail: string;
    readonly repoId: string;
    readonly invocationId: string;
    readonly sourceSummaryPath: string;
    readonly sourceReceiptPath: string;
    readonly retainedScratchPath: string;
    readonly retainedCopyPath: string;
    readonly cwd: string;
    readonly artifactNamespace: string;
    readonly diagnosticPath: string;
    readonly argv: readonly string[];
    readonly command: readonly string[];
    readonly timeoutSeconds: number;
    readonly candidate: CandidateIdentity;
    readonly capture: CommandCapture;
    readonly identityVerification: {
        readonly before: "verified";
        readonly after: "verified" | "failed";
        readonly detail: string;
    };
    readonly freshCopyCleanup: FreshCopyCleanup;
}
declare const E2EDiagnosticError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "E2EDiagnosticError";
} & Readonly<A>;
export declare class E2EDiagnosticError extends E2EDiagnosticError_base<{
    readonly detail: string;
}> {
}
export declare const runDiagnostic: (options: DiagnoseOptions) => Effect.Effect<DiagnosticSummary, E2EDiagnosticError, FileSystem.FileSystem | OwnedProcess | Scope.Scope>;
export {};
