import { Context, Effect, Layer, Scope } from "effect";
export type OwnedProcessOutput = "capture" | "inherit";
export type OwnedTermination = "timeout" | "cancelled";
export interface OwnedProcessOptions {
    readonly cwd: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly output: OwnedProcessOutput;
    readonly stream?: boolean;
    readonly timeoutMs?: number;
    readonly streamPrefix?: string;
}
export interface OwnedProcessGroupCleanup {
    readonly owned: boolean;
    readonly checked: boolean;
    readonly aliveAfterLeaderClose: boolean | null;
    readonly groupId?: number;
    readonly signalsSent: readonly NodeJS.Signals[];
    readonly gone: boolean | null;
    readonly detail: string;
}
export interface OwnedProcessResult {
    readonly command: readonly string[];
    readonly exitCode: number | null;
    readonly signal: NodeJS.Signals | null;
    readonly timedOut: boolean;
    readonly cancelled: boolean;
    readonly stdout: string;
    readonly stderr: string;
    readonly error?: string;
    readonly processGroupOwned: boolean;
    readonly groupCleanup: OwnedProcessGroupCleanup;
}
declare const OwnedProcessError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "OwnedProcessError";
} & Readonly<A>;
export declare class OwnedProcessError extends OwnedProcessError_base<{
    readonly operation: "spawn" | "observe";
    readonly detail: string;
}> {
}
declare const E2EExecutionCancelledError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "E2EExecutionCancelledError";
} & Readonly<A>;
export declare class E2EExecutionCancelledError extends E2EExecutionCancelledError_base<{
    readonly detail: string;
}> {
}
export interface OwnedProcessService {
    readonly run: (command: readonly string[], options: OwnedProcessOptions) => Effect.Effect<OwnedProcessResult, OwnedProcessError, Scope.Scope>;
    readonly requestStop: (signal: NodeJS.Signals) => Effect.Effect<void>;
    readonly stop: (signal: NodeJS.Signals) => Effect.Effect<void>;
    readonly forceKill: Effect.Effect<void>;
    readonly activeCount: Effect.Effect<number>;
    readonly awaitIdle: Effect.Effect<void>;
}
declare const OwnedProcess_base: Context.ServiceClass<OwnedProcess, "niceeval/e2e/OwnedProcess", OwnedProcessService>;
export declare class OwnedProcess extends OwnedProcess_base {
}
export declare const runOwnedProcess: (command: readonly string[], options: OwnedProcessOptions) => Effect.Effect<OwnedProcessResult, OwnedProcessError, Scope.Scope | OwnedProcess>;
export declare const requestStopOwnedProcesses: (signal: NodeJS.Signals) => Effect.Effect<void, never, OwnedProcess>;
export declare const stopOwnedProcesses: (signal: NodeJS.Signals) => Effect.Effect<void, never, OwnedProcess>;
export declare const forceKillOwnedProcesses: Effect.Effect<void, never, OwnedProcess>;
export declare const observeOwnedProcessActivity: Effect.Effect<number, never, OwnedProcess>;
export declare function hasConfirmedOwnedGroupCleanup(result: Pick<OwnedProcessResult, "processGroupOwned" | "groupCleanup">): boolean;
export declare function hasSuccessfulOwnedProcessResult(result: Pick<OwnedProcessResult, "exitCode" | "signal" | "timedOut" | "cancelled" | "error" | "processGroupOwned" | "groupCleanup">): boolean;
export declare function ownedProcessLayer(options?: {
    readonly graceMs?: number;
}): Layer.Layer<OwnedProcess, never, never>;
export declare const OwnedProcessLive: Layer.Layer<OwnedProcess, never, never>;
export {};
