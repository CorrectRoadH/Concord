import * as FileSystem from "effect/FileSystem";
import { Effect, Scope } from "effect";
import { type OwnedProcess } from "./owned-process.ts";
declare const TestkitSnapshotError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "TestkitSnapshotError";
} & Readonly<A>;
export declare class TestkitSnapshotError extends TestkitSnapshotError_base<{
    readonly operation: "build" | "verify" | "inject";
    readonly detail: string;
}> {
}
export interface TestkitPackage {
    readonly path: string;
    readonly sourcePath: "packages/testkit";
    readonly name: "@niceeval/testkit";
    readonly version: string;
    readonly digest: string;
}
export interface TestkitBuildDependencies {
    readonly buildTestkit?: (sourceDir: string, stagingDir: string) => Effect.Effect<number, TestkitSnapshotError, OwnedProcess | Scope.Scope>;
}
export declare const verifyTestkitSnapshot: (testkit: TestkitPackage) => Effect.Effect<void, TestkitSnapshotError, FileSystem.FileSystem>;
export declare const buildTestkitPackage: (repoRoot: string, scratchRoot: string, dependencies?: TestkitBuildDependencies) => Effect.Effect<TestkitPackage, TestkitSnapshotError, FileSystem.FileSystem | OwnedProcess | Scope.Scope>;
export declare const acquireTestkitPackage: (repoRoot: string, scratchRoot: string, dependencies?: TestkitBuildDependencies) => Effect.Effect<TestkitPackage, TestkitSnapshotError, FileSystem.FileSystem | Scope.Scope | OwnedProcess>;
export declare const checkTestkitSourceClean: (copyDir: string) => Effect.Effect<readonly string[], TestkitSnapshotError, FileSystem.FileSystem>;
export declare const scanForTestkitImports: (copyDir: string) => Effect.Effect<readonly string[], TestkitSnapshotError, FileSystem.FileSystem>;
export declare const injectTestkitDirectory: (copyDir: string, testkit: TestkitPackage) => Effect.Effect<void, TestkitSnapshotError, FileSystem.FileSystem>;
export interface TestkitDirectoryResolution {
    readonly key: string;
    readonly directory: string;
}
export declare const verifyTestkitDirectoryResolution: (lockfileText: string, expectedDirectory: string, copyDir: string) => {
    readonly ok: true;
    readonly resolution: TestkitDirectoryResolution;
} | {
    readonly ok: false;
    readonly reason: string;
};
export declare const testkitInstallPath: (copyDir: string) => string;
export declare const verifyInstalledTestkit: (copyDir: string, testkit: TestkitPackage) => Effect.Effect<{
    readonly ok: true;
    readonly installedPath: string;
    readonly realPath: string;
} | {
    readonly ok: false;
    readonly reason: string;
}, TestkitSnapshotError, FileSystem.FileSystem>;
export {};
