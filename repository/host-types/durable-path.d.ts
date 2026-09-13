import { type Stats } from "node:fs";
import * as FileSystem from "effect/FileSystem";
import { Effect } from "effect";
declare const DurablePathError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "DurablePathError";
} & Readonly<A>;
export declare class DurablePathError extends DurablePathError_base<{
    readonly operation: string;
    readonly detail: string;
}> {
}
/** Callback-only lstat leaf: do not replace with stat, which follows links. */
export declare const lstatPath: (path: string) => Effect.Effect<Stats, DurablePathError>;
export declare const lstatOptional: (path: string) => Effect.Effect<Stats | undefined, DurablePathError>;
export declare const containedDurablePath: (root: string, target: string, label: string, allowRoot?: boolean) => string;
export declare const ensureRealDirectory: (path: string, label: string) => Effect.Effect<string, DurablePathError, FileSystem.FileSystem>;
export declare const assertRealDirectory: (path: string, label: string) => Effect.Effect<string, DurablePathError, FileSystem.FileSystem>;
export declare const ensureContainedRealDirectory: (root: string, target: string, label: string) => Effect.Effect<string, DurablePathError, FileSystem.FileSystem>;
export declare const assertContainedRealDirectory: (root: string, target: string, label: string) => Effect.Effect<string, DurablePathError, FileSystem.FileSystem>;
export declare const prepareContainedRegularFile: (root: string, target: string, label: string) => Effect.Effect<string, DurablePathError, FileSystem.FileSystem>;
export declare const assertContainedRegularFile: (root: string, target: string, label: string) => Effect.Effect<string, DurablePathError, FileSystem.FileSystem>;
export declare const writeContainedUtf8File: (root: string, target: string, contents: string, label: string) => Effect.Effect<string, DurablePathError, FileSystem.FileSystem>;
export declare const copyIntoContainedFile: (root: string, source: string, target: string, label: string) => Effect.Effect<string, DurablePathError, FileSystem.FileSystem>;
export {};
