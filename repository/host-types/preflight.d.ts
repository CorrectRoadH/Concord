import { Effect, Scope } from "effect";
import type { Browser, E2ERepoManifest } from "./manifest.ts";
import type { CapabilityCheck } from "./receipt.ts";
export interface CapabilityPreflightResult {
    readonly ok: boolean;
    readonly cancelled: boolean;
    readonly checks: readonly CapabilityCheck[];
    readonly failureCategory?: "configuration" | "infra";
}
declare const CapabilityPreflightError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "CapabilityPreflightError";
} & Readonly<A>;
export declare class CapabilityPreflightError extends CapabilityPreflightError_base<{
    readonly operation: "host" | "browser";
    readonly detail: string;
}> {
}
/** Runs every declared host capability; one failed check never hides later checks. */
export declare function preflightHostCapabilities(manifest: E2ERepoManifest, env: NodeJS.ProcessEnv): Effect.Effect<CapabilityPreflightResult, CapabilityPreflightError, Scope.Scope | import("./owned-process.ts").OwnedProcess>;
/** Browser preflight is intentionally after the isolated repo installs Playwright. */
export declare function preflightBrowsers(browsers: readonly Browser[] | undefined, cwd: string, env: NodeJS.ProcessEnv): Effect.Effect<CapabilityPreflightResult, CapabilityPreflightError, Scope.Scope | import("./owned-process.ts").OwnedProcess>;
export {};
