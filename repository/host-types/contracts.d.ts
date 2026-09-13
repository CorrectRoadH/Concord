import { Result, Schema } from "effect";
export declare const OwnDecodeOptions: Readonly<{
    errors: "all";
    onExcessProperty: "error";
}>;
declare const ContractDecodeError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "ContractDecodeError";
} & Readonly<A>;
export declare class ContractDecodeError extends ContractDecodeError_base<{
    readonly schema: string;
    readonly issue: Schema.SchemaError;
}> {
}
export declare const decodeOwned: <S extends Schema.ConstraintDecoder<unknown, never>>(schema: S, name: string) => (input: unknown) => Result.Result<S["Type"], ContractDecodeError>;
/** Third-party documents are decoded only as the projection the runner consumes. */
export declare const decodeExternal: <S extends Schema.ConstraintDecoder<unknown, never>>(schema: S, name: string) => (input: unknown) => Result.Result<S["Type"], ContractDecodeError>;
export declare const LANES: readonly ["pr", "main", "nightly", "release"];
export declare const AREAS: readonly ["eval", "cli", "inspection", "insight", "record", "package", "runner", "adapter", "sandbox", "lifecycle"];
export declare const PLATFORMS: readonly ["linux", "darwin"];
export declare const BROWSERS: readonly ["chromium", "firefox", "webkit"];
export declare const HOST_CAPABILITIES: readonly ["linux-loop-project-quota"];
export declare const HARNESS_ASSETS: readonly ["docker-profile-host-scripts"];
export declare const MANIFEST_SCHEMA_VERSION: 3;
export declare const MANIFEST_SCHEMA_VERSIONS: readonly [3];
export declare const LaneSchema: Schema.Literals<readonly ["pr", "main", "nightly", "release"]>;
export declare const AreaSchema: Schema.Literals<readonly ["eval", "cli", "inspection", "insight", "record", "package", "runner", "adapter", "sandbox", "lifecycle"]>;
export declare const PlatformSchema: Schema.Literals<readonly ["linux", "darwin"]>;
export declare const BrowserSchema: Schema.Literals<readonly ["chromium", "firefox", "webkit"]>;
export declare const HostCapabilitySchema: Schema.Literals<readonly ["linux-loop-project-quota"]>;
export declare const HarnessAssetSchema: Schema.Literals<readonly ["docker-profile-host-scripts"]>;
export declare const PlanModeSchema: Schema.Literals<readonly ["invalid", "affected", "full", "fail-open-full"]>;
export declare const CategorySchema: Schema.Literals<readonly ["pass", "regression", "infra", "configuration", "cancelled"]>;
export declare const StageNameSchema: Schema.Literals<readonly ["preflight", "prepare", "install", "injection", "browser", "test", "collect", "cleanup"]>;
export declare const RepoIdSchema: Schema.String;
export declare const BatchIdSchema: Schema.String;
export declare const ArtifactPatternSchema: Schema.String;
export declare const PositiveSafeIntegerSchema: Schema.Number;
export declare const Sha256HexSchema: Schema.String;
export declare const SriSchema: Schema.String;
export declare const ExecutorSchema: Schema.Struct<{
    readonly kind: Schema.Literals<readonly ["host"]>;
}>;
export declare const RepoRequiresSchema: Schema.Struct<{
    readonly docker: Schema.optional<Schema.Boolean>;
    readonly externalNetwork: Schema.optional<Schema.Boolean>;
    readonly platforms: Schema.optional<Schema.$Array<Schema.Literals<readonly ["linux", "darwin"]>>>;
    readonly runtimes: Schema.optional<Schema.$Array<Schema.String>>;
    readonly browsers: Schema.optional<Schema.$Array<Schema.Literals<readonly ["chromium", "firefox", "webkit"]>>>;
    readonly hostCapabilities: Schema.optional<Schema.$Array<Schema.Literals<readonly ["linux-loop-project-quota"]>>>;
}>;
export declare const RepoHarnessSchema: Schema.Struct<{
    readonly testkit: Schema.optional<Schema.Boolean>;
    readonly assets: Schema.optional<Schema.$Array<Schema.Literals<readonly ["docker-profile-host-scripts"]>>>;
}>;
/** The target metadata itself: repo identity is deliberately derived by discovery. */
export declare const ManifestMetadataSchema: Schema.Struct<{
    readonly schemaVersion: Schema.Literals<readonly [3]>;
    readonly batch: Schema.String;
    readonly areas: Schema.NonEmptyArray<Schema.Literals<readonly ["eval", "cli", "inspection", "insight", "record", "package", "runner", "adapter", "sandbox", "lifecycle"]>>;
    readonly lanes: Schema.NonEmptyArray<Schema.Literals<readonly ["pr", "main", "nightly", "release"]>>;
    readonly executor: Schema.Struct<{
        readonly kind: Schema.Literals<readonly ["host"]>;
    }>;
    readonly command: Schema.NonEmptyArray<Schema.String>;
    readonly timeoutMinutes: Schema.Number;
    readonly secrets: Schema.$Array<Schema.String>;
    readonly requires: Schema.optional<Schema.Struct<{
        readonly docker: Schema.optional<Schema.Boolean>;
        readonly externalNetwork: Schema.optional<Schema.Boolean>;
        readonly platforms: Schema.optional<Schema.$Array<Schema.Literals<readonly ["linux", "darwin"]>>>;
        readonly runtimes: Schema.optional<Schema.$Array<Schema.String>>;
        readonly browsers: Schema.optional<Schema.$Array<Schema.Literals<readonly ["chromium", "firefox", "webkit"]>>>;
        readonly hostCapabilities: Schema.optional<Schema.$Array<Schema.Literals<readonly ["linux-loop-project-quota"]>>>;
    }>>;
    readonly harness: Schema.optional<Schema.Struct<{
        readonly testkit: Schema.optional<Schema.Boolean>;
        readonly assets: Schema.optional<Schema.$Array<Schema.Literals<readonly ["docker-profile-host-scripts"]>>>;
    }>>;
    readonly artifacts: Schema.$Array<Schema.String>;
}>;
export declare const ManifestSchema: Schema.Struct<{
    readonly schemaVersion: Schema.Literals<readonly [3]>;
    readonly batch: Schema.String;
    readonly areas: Schema.NonEmptyArray<Schema.Literals<readonly ["eval", "cli", "inspection", "insight", "record", "package", "runner", "adapter", "sandbox", "lifecycle"]>>;
    readonly lanes: Schema.NonEmptyArray<Schema.Literals<readonly ["pr", "main", "nightly", "release"]>>;
    readonly executor: Schema.Struct<{
        readonly kind: Schema.Literals<readonly ["host"]>;
    }>;
    readonly command: Schema.NonEmptyArray<Schema.String>;
    readonly timeoutMinutes: Schema.Number;
    readonly secrets: Schema.$Array<Schema.String>;
    readonly requires: Schema.optional<Schema.Struct<{
        readonly docker: Schema.optional<Schema.Boolean>;
        readonly externalNetwork: Schema.optional<Schema.Boolean>;
        readonly platforms: Schema.optional<Schema.$Array<Schema.Literals<readonly ["linux", "darwin"]>>>;
        readonly runtimes: Schema.optional<Schema.$Array<Schema.String>>;
        readonly browsers: Schema.optional<Schema.$Array<Schema.Literals<readonly ["chromium", "firefox", "webkit"]>>>;
        readonly hostCapabilities: Schema.optional<Schema.$Array<Schema.Literals<readonly ["linux-loop-project-quota"]>>>;
    }>>;
    readonly harness: Schema.optional<Schema.Struct<{
        readonly testkit: Schema.optional<Schema.Boolean>;
        readonly assets: Schema.optional<Schema.$Array<Schema.Literals<readonly ["docker-profile-host-scripts"]>>>;
    }>>;
    readonly artifacts: Schema.$Array<Schema.String>;
    readonly id: Schema.String;
}>;
export declare const PlanRangeSchema: Schema.Struct<{
    readonly base: Schema.String;
    readonly head: Schema.String;
}>;
export declare const PlanEntrySchema: Schema.Struct<{
    readonly id: Schema.String;
    readonly repoIds: Schema.NonEmptyArray<Schema.String>;
    readonly batch: Schema.String;
    readonly dir: Schema.optional<Schema.String>;
    readonly dirs: Schema.NonEmptyArray<Schema.String>;
    readonly executor: Schema.Struct<{
        readonly kind: Schema.Literals<readonly ["host"]>;
    }>;
    readonly capabilities: Schema.NonEmptyArray<Schema.Literals<readonly ["eval", "cli", "inspection", "insight", "record", "package", "runner", "adapter", "sandbox", "lifecycle"]>>;
    readonly shard: Schema.String;
    readonly requires: Schema.optional<Schema.Struct<{
        readonly docker: Schema.optional<Schema.Boolean>;
        readonly externalNetwork: Schema.optional<Schema.Boolean>;
        readonly platforms: Schema.optional<Schema.$Array<Schema.Literals<readonly ["linux", "darwin"]>>>;
        readonly runtimes: Schema.optional<Schema.$Array<Schema.String>>;
        readonly browsers: Schema.optional<Schema.$Array<Schema.Literals<readonly ["chromium", "firefox", "webkit"]>>>;
        readonly hostCapabilities: Schema.optional<Schema.$Array<Schema.Literals<readonly ["linux-loop-project-quota"]>>>;
    }>>;
}>;
export declare const PlanDocumentSchema: Schema.Struct<{
    readonly mode: Schema.Literals<readonly ["affected", "full", "fail-open-full"]>;
    readonly reason: Schema.String;
    readonly detail: Schema.optional<Schema.String>;
    readonly lane: Schema.Literals<readonly ["pr", "main", "nightly", "release"]>;
    readonly range: Schema.optional<Schema.Struct<{
        readonly base: Schema.String;
        readonly head: Schema.String;
    }>>;
    readonly changedPaths: Schema.$Array<Schema.String>;
    readonly projectIds: Schema.$Array<Schema.String>;
    readonly cells: Schema.$Array<Schema.Struct<{
        readonly id: Schema.String;
        readonly repoIds: Schema.NonEmptyArray<Schema.String>;
        readonly batch: Schema.String;
        readonly dir: Schema.optional<Schema.String>;
        readonly dirs: Schema.NonEmptyArray<Schema.String>;
        readonly executor: Schema.Struct<{
            readonly kind: Schema.Literals<readonly ["host"]>;
        }>;
        readonly capabilities: Schema.NonEmptyArray<Schema.Literals<readonly ["eval", "cli", "inspection", "insight", "record", "package", "runner", "adapter", "sandbox", "lifecycle"]>>;
        readonly shard: Schema.String;
        readonly requires: Schema.optional<Schema.Struct<{
            readonly docker: Schema.optional<Schema.Boolean>;
            readonly externalNetwork: Schema.optional<Schema.Boolean>;
            readonly platforms: Schema.optional<Schema.$Array<Schema.Literals<readonly ["linux", "darwin"]>>>;
            readonly runtimes: Schema.optional<Schema.$Array<Schema.String>>;
            readonly browsers: Schema.optional<Schema.$Array<Schema.Literals<readonly ["chromium", "firefox", "webkit"]>>>;
            readonly hostCapabilities: Schema.optional<Schema.$Array<Schema.Literals<readonly ["linux-loop-project-quota"]>>>;
        }>>;
    }>>;
    readonly graph: Schema.Struct<{
        readonly selector: Schema.Literals<readonly ["nx show projects --affected --with-target e2e"]>;
        readonly nxVersion: Schema.String;
        readonly affectedProjectNames: Schema.$Array<Schema.String>;
        readonly selectedE2EProjectNames: Schema.$Array<Schema.String>;
        readonly e2eProjectNames: Schema.$Array<Schema.String>;
    }>;
}>;
export declare const InvalidPlanOutputSchema: Schema.Struct<{
    readonly mode: Schema.Literals<readonly ["invalid"]>;
    readonly reason: Schema.Literals<readonly ["invalid-plan"]>;
    readonly detail: Schema.String;
    readonly cells: Schema.Tuple<readonly []>;
    readonly projectIds: Schema.Tuple<readonly []>;
    readonly changedPaths: Schema.Tuple<readonly []>;
}>;
/** Minimal plan cell projection consumed by a run command. */
export declare const PlanRunCellSchema: Schema.Struct<{
    readonly id: Schema.String;
    readonly repoIds: Schema.NonEmptyArray<Schema.String>;
    readonly batch: Schema.String;
    readonly dirs: Schema.NonEmptyArray<Schema.String>;
    readonly executor: Schema.Struct<{
        readonly kind: Schema.Literals<readonly ["host"]>;
    }>;
    readonly requires: Schema.optional<Schema.Struct<{
        readonly docker: Schema.optional<Schema.Boolean>;
        readonly externalNetwork: Schema.optional<Schema.Boolean>;
        readonly platforms: Schema.optional<Schema.$Array<Schema.Literals<readonly ["linux", "darwin"]>>>;
        readonly runtimes: Schema.optional<Schema.$Array<Schema.String>>;
        readonly browsers: Schema.optional<Schema.$Array<Schema.Literals<readonly ["chromium", "firefox", "webkit"]>>>;
        readonly hostCapabilities: Schema.optional<Schema.$Array<Schema.Literals<readonly ["linux-loop-project-quota"]>>>;
    }>>;
}>;
export declare const CommandCaptureSchema: Schema.Struct<{
    readonly exitCode: Schema.NullOr<Schema.Number>;
    readonly signal: Schema.NullOr<Schema.String>;
    readonly timedOut: Schema.Boolean;
    readonly cancelled: Schema.Boolean;
    readonly stdout: Schema.String;
    readonly stderr: Schema.String;
    readonly error: Schema.optional<Schema.String>;
    readonly processGroupOwned: Schema.Boolean;
    readonly groupCleanup: Schema.Struct<{
        readonly owned: Schema.Boolean;
        readonly checked: Schema.Boolean;
        readonly aliveAfterLeaderClose: Schema.NullOr<Schema.Boolean>;
        readonly groupId: Schema.optional<Schema.Number>;
        readonly signalsSent: Schema.$Array<Schema.String>;
        readonly gone: Schema.NullOr<Schema.Boolean>;
        readonly detail: Schema.String;
    }>;
}>;
export declare const CapabilityCheckSchema: Schema.Struct<{
    readonly kind: Schema.Literals<readonly ["platform", "runtime", "docker", "browser", "secret", "externalNetwork", "hostCapability"]>;
    readonly subject: Schema.String;
    readonly ok: Schema.Boolean;
    readonly verification: Schema.optional<Schema.Literals<readonly ["checked", "declared-unverified"]>>;
    readonly failureCategory: Schema.optional<Schema.Literals<readonly ["configuration", "infra"]>>;
    readonly detail: Schema.String;
    readonly command: Schema.optional<Schema.$Array<Schema.String>>;
    readonly capture: Schema.optional<Schema.Struct<{
        readonly exitCode: Schema.NullOr<Schema.Number>;
        readonly signal: Schema.NullOr<Schema.String>;
        readonly timedOut: Schema.Boolean;
        readonly cancelled: Schema.Boolean;
        readonly stdout: Schema.String;
        readonly stderr: Schema.String;
        readonly error: Schema.optional<Schema.String>;
        readonly processGroupOwned: Schema.Boolean;
        readonly groupCleanup: Schema.Struct<{
            readonly owned: Schema.Boolean;
            readonly checked: Schema.Boolean;
            readonly aliveAfterLeaderClose: Schema.NullOr<Schema.Boolean>;
            readonly groupId: Schema.optional<Schema.Number>;
            readonly signalsSent: Schema.$Array<Schema.String>;
            readonly gone: Schema.NullOr<Schema.Boolean>;
            readonly detail: Schema.String;
        }>;
    }>>;
}>;
export declare const StageReceiptSchema: Schema.Struct<{
    readonly stage: Schema.Literals<readonly ["preflight", "prepare", "install", "injection", "browser", "test", "collect", "cleanup"]>;
    readonly ok: Schema.Boolean;
    readonly cancelled: Schema.optional<Schema.Boolean>;
    readonly failureCategory: Schema.optional<Schema.Literals<readonly ["configuration", "infra"]>>;
    readonly detail: Schema.optional<Schema.String>;
    readonly command: Schema.optional<Schema.$Array<Schema.String>>;
    readonly capture: Schema.optional<Schema.Struct<{
        readonly exitCode: Schema.NullOr<Schema.Number>;
        readonly signal: Schema.NullOr<Schema.String>;
        readonly timedOut: Schema.Boolean;
        readonly cancelled: Schema.Boolean;
        readonly stdout: Schema.String;
        readonly stderr: Schema.String;
        readonly error: Schema.optional<Schema.String>;
        readonly processGroupOwned: Schema.Boolean;
        readonly groupCleanup: Schema.Struct<{
            readonly owned: Schema.Boolean;
            readonly checked: Schema.Boolean;
            readonly aliveAfterLeaderClose: Schema.NullOr<Schema.Boolean>;
            readonly groupId: Schema.optional<Schema.Number>;
            readonly signalsSent: Schema.$Array<Schema.String>;
            readonly gone: Schema.NullOr<Schema.Boolean>;
            readonly detail: Schema.String;
        }>;
    }>>;
    readonly attempt: Schema.optional<Schema.Number>;
    readonly invocationId: Schema.optional<Schema.String>;
    readonly checks: Schema.optional<Schema.$Array<Schema.Struct<{
        readonly kind: Schema.Literals<readonly ["platform", "runtime", "docker", "browser", "secret", "externalNetwork", "hostCapability"]>;
        readonly subject: Schema.String;
        readonly ok: Schema.Boolean;
        readonly verification: Schema.optional<Schema.Literals<readonly ["checked", "declared-unverified"]>>;
        readonly failureCategory: Schema.optional<Schema.Literals<readonly ["configuration", "infra"]>>;
        readonly detail: Schema.String;
        readonly command: Schema.optional<Schema.$Array<Schema.String>>;
        readonly capture: Schema.optional<Schema.Struct<{
            readonly exitCode: Schema.NullOr<Schema.Number>;
            readonly signal: Schema.NullOr<Schema.String>;
            readonly timedOut: Schema.Boolean;
            readonly cancelled: Schema.Boolean;
            readonly stdout: Schema.String;
            readonly stderr: Schema.String;
            readonly error: Schema.optional<Schema.String>;
            readonly processGroupOwned: Schema.Boolean;
            readonly groupCleanup: Schema.Struct<{
                readonly owned: Schema.Boolean;
                readonly checked: Schema.Boolean;
                readonly aliveAfterLeaderClose: Schema.NullOr<Schema.Boolean>;
                readonly groupId: Schema.optional<Schema.Number>;
                readonly signalsSent: Schema.$Array<Schema.String>;
                readonly gone: Schema.NullOr<Schema.Boolean>;
                readonly detail: Schema.String;
            }>;
        }>>;
    }>>>;
    readonly assets: Schema.optional<Schema.$Array<Schema.Literals<readonly ["docker-profile-host-scripts"]>>>;
    readonly collected: Schema.optional<Schema.$Array<Schema.String>>;
    readonly path: Schema.optional<Schema.String>;
}>;
export declare const SelectionReceiptSchema: Schema.Struct<{
    readonly mode: Schema.Literals<readonly ["affected", "full", "fail-open-full"]>;
    readonly reason: Schema.String;
    readonly lane: Schema.Literals<readonly ["pr", "main", "nightly", "release"]>;
    readonly cellId: Schema.String;
    readonly range: Schema.optional<Schema.Struct<{
        readonly base: Schema.String;
        readonly head: Schema.String;
    }>>;
}>;
export declare const CandidateIdentitySchema: Schema.Struct<{
    readonly sha256: Schema.String;
    readonly integrity: Schema.String;
    readonly artifactPath: Schema.optional<Schema.String>;
    readonly reproduce: Schema.String;
    readonly exactReplay: Schema.Boolean;
}>;
export declare const TestkitReceiptSchema: Schema.Struct<{
    readonly version: Schema.String;
    readonly sourcePath: Schema.Literals<readonly ["packages/testkit"]>;
    readonly resolvedPath: Schema.String;
    readonly digest: Schema.String;
}>;
export declare const RepoReceiptSchema: Schema.Struct<{
    readonly repoId: Schema.String;
    readonly selection: Schema.optional<Schema.Struct<{
        readonly mode: Schema.Literals<readonly ["affected", "full", "fail-open-full"]>;
        readonly reason: Schema.String;
        readonly lane: Schema.Literals<readonly ["pr", "main", "nightly", "release"]>;
        readonly cellId: Schema.String;
        readonly range: Schema.optional<Schema.Struct<{
            readonly base: Schema.String;
            readonly head: Schema.String;
        }>>;
    }>>;
    readonly invocationIds: Schema.NonEmptyArray<Schema.String>;
    readonly testInvocations: Schema.Number;
    readonly copyId: Schema.optional<Schema.String>;
    readonly runLabel: Schema.optional<Schema.String>;
    readonly sourceSnapshotDigest: Schema.optional<Schema.String>;
    readonly artifactDir: Schema.String;
    readonly receiptPath: Schema.String;
    readonly stages: Schema.$Array<Schema.Struct<{
        readonly stage: Schema.Literals<readonly ["preflight", "prepare", "install", "injection", "browser", "test", "collect", "cleanup"]>;
        readonly ok: Schema.Boolean;
        readonly cancelled: Schema.optional<Schema.Boolean>;
        readonly failureCategory: Schema.optional<Schema.Literals<readonly ["configuration", "infra"]>>;
        readonly detail: Schema.optional<Schema.String>;
        readonly command: Schema.optional<Schema.$Array<Schema.String>>;
        readonly capture: Schema.optional<Schema.Struct<{
            readonly exitCode: Schema.NullOr<Schema.Number>;
            readonly signal: Schema.NullOr<Schema.String>;
            readonly timedOut: Schema.Boolean;
            readonly cancelled: Schema.Boolean;
            readonly stdout: Schema.String;
            readonly stderr: Schema.String;
            readonly error: Schema.optional<Schema.String>;
            readonly processGroupOwned: Schema.Boolean;
            readonly groupCleanup: Schema.Struct<{
                readonly owned: Schema.Boolean;
                readonly checked: Schema.Boolean;
                readonly aliveAfterLeaderClose: Schema.NullOr<Schema.Boolean>;
                readonly groupId: Schema.optional<Schema.Number>;
                readonly signalsSent: Schema.$Array<Schema.String>;
                readonly gone: Schema.NullOr<Schema.Boolean>;
                readonly detail: Schema.String;
            }>;
        }>>;
        readonly attempt: Schema.optional<Schema.Number>;
        readonly invocationId: Schema.optional<Schema.String>;
        readonly checks: Schema.optional<Schema.$Array<Schema.Struct<{
            readonly kind: Schema.Literals<readonly ["platform", "runtime", "docker", "browser", "secret", "externalNetwork", "hostCapability"]>;
            readonly subject: Schema.String;
            readonly ok: Schema.Boolean;
            readonly verification: Schema.optional<Schema.Literals<readonly ["checked", "declared-unverified"]>>;
            readonly failureCategory: Schema.optional<Schema.Literals<readonly ["configuration", "infra"]>>;
            readonly detail: Schema.String;
            readonly command: Schema.optional<Schema.$Array<Schema.String>>;
            readonly capture: Schema.optional<Schema.Struct<{
                readonly exitCode: Schema.NullOr<Schema.Number>;
                readonly signal: Schema.NullOr<Schema.String>;
                readonly timedOut: Schema.Boolean;
                readonly cancelled: Schema.Boolean;
                readonly stdout: Schema.String;
                readonly stderr: Schema.String;
                readonly error: Schema.optional<Schema.String>;
                readonly processGroupOwned: Schema.Boolean;
                readonly groupCleanup: Schema.Struct<{
                    readonly owned: Schema.Boolean;
                    readonly checked: Schema.Boolean;
                    readonly aliveAfterLeaderClose: Schema.NullOr<Schema.Boolean>;
                    readonly groupId: Schema.optional<Schema.Number>;
                    readonly signalsSent: Schema.$Array<Schema.String>;
                    readonly gone: Schema.NullOr<Schema.Boolean>;
                    readonly detail: Schema.String;
                }>;
            }>>;
        }>>>;
        readonly assets: Schema.optional<Schema.$Array<Schema.Literals<readonly ["docker-profile-host-scripts"]>>>;
        readonly collected: Schema.optional<Schema.$Array<Schema.String>>;
        readonly path: Schema.optional<Schema.String>;
    }>>;
    readonly exitCode: Schema.NullOr<Schema.Number>;
    readonly category: Schema.Literals<readonly ["pass", "regression", "infra", "configuration", "cancelled"]>;
    readonly detail: Schema.String;
    readonly candidate: Schema.Struct<{
        readonly sha256: Schema.String;
        readonly integrity: Schema.String;
        readonly artifactPath: Schema.optional<Schema.String>;
        readonly reproduce: Schema.String;
        readonly exactReplay: Schema.Boolean;
    }>;
    readonly testkit: Schema.optional<Schema.Struct<{
        readonly version: Schema.String;
        readonly sourcePath: Schema.Literals<readonly ["packages/testkit"]>;
        readonly resolvedPath: Schema.String;
        readonly digest: Schema.String;
    }>>;
}>;
export declare const ScratchDispositionSchema: Schema.Union<readonly [Schema.Struct<{
    readonly kind: Schema.Literals<readonly ["not-created"]>;
    readonly ok: Schema.Literals<readonly [true]>;
    readonly detail: Schema.String;
}>, Schema.Struct<{
    readonly kind: Schema.Literals<readonly ["removed", "retained"]>;
    readonly ok: Schema.Literals<readonly [true]>;
    readonly path: Schema.String;
    readonly detail: Schema.String;
}>, Schema.Struct<{
    readonly kind: Schema.Literals<readonly ["remove-failed"]>;
    readonly ok: Schema.Literals<readonly [false]>;
    readonly path: Schema.String;
    readonly detail: Schema.String;
}>]>;
export declare const RunnerTerminalSummarySchema: Schema.Struct<{
    readonly category: Schema.Literals<readonly ["pass", "infra"]>;
    readonly detail: Schema.String;
    readonly scratchDisposition: Schema.Union<readonly [Schema.Struct<{
        readonly kind: Schema.Literals<readonly ["not-created"]>;
        readonly ok: Schema.Literals<readonly [true]>;
        readonly detail: Schema.String;
    }>, Schema.Struct<{
        readonly kind: Schema.Literals<readonly ["removed", "retained"]>;
        readonly ok: Schema.Literals<readonly [true]>;
        readonly path: Schema.String;
        readonly detail: Schema.String;
    }>, Schema.Struct<{
        readonly kind: Schema.Literals<readonly ["remove-failed"]>;
        readonly ok: Schema.Literals<readonly [false]>;
        readonly path: Schema.String;
        readonly detail: Schema.String;
    }>]>;
}>;
export declare const RunSummaryResultSchema: Schema.Struct<{
    readonly id: Schema.String;
    readonly exitCode: Schema.NullOr<Schema.Number>;
    readonly category: Schema.Literals<readonly ["pass", "regression", "infra", "configuration", "cancelled"]>;
    readonly detail: Schema.String;
    readonly artifactDir: Schema.String;
    readonly receiptPath: Schema.String;
}>;
export declare const RunSummarySchema: Schema.Struct<{
    readonly artifactRoot: Schema.String;
    readonly summaryPath: Schema.String;
    readonly results: Schema.$Array<Schema.Struct<{
        readonly id: Schema.String;
        readonly exitCode: Schema.NullOr<Schema.Number>;
        readonly category: Schema.Literals<readonly ["pass", "regression", "infra", "configuration", "cancelled"]>;
        readonly detail: Schema.String;
        readonly artifactDir: Schema.String;
        readonly receiptPath: Schema.String;
    }>>;
    readonly passed: Schema.Number;
    readonly regression: Schema.Number;
    readonly infra: Schema.Number;
    readonly configuration: Schema.Number;
    readonly cancelled: Schema.Number;
    readonly total: Schema.Number;
    readonly category: Schema.Literals<readonly ["pass", "regression", "infra", "configuration", "cancelled"]>;
    readonly detail: Schema.String;
    readonly runner: Schema.Struct<{
        readonly category: Schema.Literals<readonly ["pass", "infra"]>;
        readonly detail: Schema.String;
        readonly scratchDisposition: Schema.Union<readonly [Schema.Struct<{
            readonly kind: Schema.Literals<readonly ["not-created"]>;
            readonly ok: Schema.Literals<readonly [true]>;
            readonly detail: Schema.String;
        }>, Schema.Struct<{
            readonly kind: Schema.Literals<readonly ["removed", "retained"]>;
            readonly ok: Schema.Literals<readonly [true]>;
            readonly path: Schema.String;
            readonly detail: Schema.String;
        }>, Schema.Struct<{
            readonly kind: Schema.Literals<readonly ["remove-failed"]>;
            readonly ok: Schema.Literals<readonly [false]>;
            readonly path: Schema.String;
            readonly detail: Schema.String;
        }>]>;
    }>;
    readonly selection: Schema.optional<Schema.Struct<{
        readonly mode: Schema.Literals<readonly ["affected", "full", "fail-open-full"]>;
        readonly reason: Schema.String;
        readonly lane: Schema.Literals<readonly ["pr", "main", "nightly", "release"]>;
        readonly cellId: Schema.String;
        readonly range: Schema.optional<Schema.Struct<{
            readonly base: Schema.String;
            readonly head: Schema.String;
        }>>;
    }>>;
}>;
export declare const PackageJsonSchema: Schema.Struct<{
    readonly name: Schema.optional<Schema.String>;
    readonly version: Schema.optional<Schema.String>;
    readonly dependencies: Schema.optional<Schema.$Record<Schema.String, Schema.Unknown>>;
    readonly devDependencies: Schema.optional<Schema.$Record<Schema.String, Schema.Unknown>>;
    readonly optionalDependencies: Schema.optional<Schema.$Record<Schema.String, Schema.Unknown>>;
    readonly peerDependencies: Schema.optional<Schema.$Record<Schema.String, Schema.Unknown>>;
    readonly exports: Schema.optional<Schema.Unknown>;
}>;
export declare const TestkitPackageSchema: Schema.Struct<{
    readonly path: Schema.String;
    readonly sourcePath: Schema.Literals<readonly ["packages/testkit"]>;
    readonly name: Schema.Literals<readonly ["@niceeval/testkit"]>;
    readonly version: Schema.String;
    readonly digest: Schema.String;
}>;
export declare const PnpmLockSchema: Schema.Struct<{
    readonly lockfileVersion: Schema.optional<Schema.Union<readonly [Schema.String, Schema.Number]>>;
    readonly importers: Schema.optional<Schema.$Record<Schema.String, Schema.Unknown>>;
    readonly packages: Schema.optional<Schema.$Record<Schema.String, Schema.Unknown>>;
    readonly snapshots: Schema.optional<Schema.$Record<Schema.String, Schema.Unknown>>;
}>;
export declare const NxProjectSchema: Schema.Struct<{
    readonly data: Schema.Struct<{
        readonly root: Schema.String;
        readonly tags: Schema.optional<Schema.$Array<Schema.String>>;
        readonly targets: Schema.optional<Schema.$Record<Schema.String, Schema.Unknown>>;
    }>;
}>;
export declare const NxGraphSchema: Schema.Struct<{
    readonly graph: Schema.Struct<{
        readonly nodes: Schema.$Record<Schema.String, Schema.Struct<{
            readonly data: Schema.Struct<{
                readonly root: Schema.String;
                readonly tags: Schema.optional<Schema.$Array<Schema.String>>;
                readonly targets: Schema.optional<Schema.$Record<Schema.String, Schema.Unknown>>;
            }>;
        }>>;
        readonly dependencies: Schema.$Record<Schema.String, Schema.$Array<Schema.Struct<{
            readonly source: Schema.String;
            readonly target: Schema.String;
        }>>>;
    }>;
}>;
export declare const CandidatePackOwnerSchema: Schema.Struct<{
    readonly token: Schema.String;
    readonly pid: Schema.Number;
    readonly host: Schema.String;
    readonly createdAtMs: Schema.Number;
    readonly heartbeatAtMs: Schema.Number;
}>;
export declare const TarPackageMetadataSchema: Schema.Struct<{
    readonly name: Schema.String;
    readonly version: Schema.String;
}>;
/** Projection used by release verification; receipt extras remain opaque. */
export declare const ReleaseReceiptProjectionSchema: Schema.Struct<{
    readonly repoId: Schema.optional<Schema.String>;
    readonly category: Schema.optional<Schema.Literals<readonly ["pass", "regression", "infra", "configuration", "cancelled"]>>;
    readonly candidate: Schema.optional<Schema.Struct<{
        readonly sha256: Schema.optional<Schema.String>;
        readonly integrity: Schema.optional<Schema.String>;
        readonly artifactPath: Schema.optional<Schema.String>;
        readonly exactReplay: Schema.optional<Schema.Boolean>;
    }>>;
}>;
export type Lane = (typeof LaneSchema)["Type"];
export type Area = (typeof AreaSchema)["Type"];
export type Platform = (typeof PlatformSchema)["Type"];
export type Browser = (typeof BrowserSchema)["Type"];
export type HostCapability = (typeof HostCapabilitySchema)["Type"];
export type HarnessAsset = (typeof HarnessAssetSchema)["Type"];
export type PlanMode = (typeof PlanModeSchema)["Type"];
export type Category = (typeof CategorySchema)["Type"];
export type StageName = (typeof StageNameSchema)["Type"];
export type RepoId = (typeof RepoIdSchema)["Type"];
export type BatchId = (typeof BatchIdSchema)["Type"];
export type ArtifactPattern = (typeof ArtifactPatternSchema)["Type"];
export type PositiveSafeInteger = (typeof PositiveSafeIntegerSchema)["Type"];
export type Sha256Hex = (typeof Sha256HexSchema)["Type"];
export type Sri = (typeof SriSchema)["Type"];
export type ManifestMetadata = (typeof ManifestMetadataSchema)["Type"];
export type Manifest = (typeof ManifestSchema)["Type"];
export type PlanRange = (typeof PlanRangeSchema)["Type"];
export type PlanEntry = (typeof PlanEntrySchema)["Type"];
export type PlanDocument = (typeof PlanDocumentSchema)["Type"];
export type InvalidPlanOutput = (typeof InvalidPlanOutputSchema)["Type"];
export type PlanRunCell = (typeof PlanRunCellSchema)["Type"];
export type SelectionReceipt = (typeof SelectionReceiptSchema)["Type"];
export type CommandCapture = (typeof CommandCaptureSchema)["Type"];
export type CapabilityCheck = (typeof CapabilityCheckSchema)["Type"];
export type StageReceipt = (typeof StageReceiptSchema)["Type"];
export type CandidateIdentity = (typeof CandidateIdentitySchema)["Type"];
export type TestkitReceipt = (typeof TestkitReceiptSchema)["Type"];
export type RepoReceipt = (typeof RepoReceiptSchema)["Type"];
export type ScratchDisposition = (typeof ScratchDispositionSchema)["Type"];
export type RunnerTerminalSummary = (typeof RunnerTerminalSummarySchema)["Type"];
export type RunSummaryResult = (typeof RunSummaryResultSchema)["Type"];
export type RunSummary = (typeof RunSummarySchema)["Type"];
export type PackageJson = (typeof PackageJsonSchema)["Type"];
export type TestkitPackage = (typeof TestkitPackageSchema)["Type"];
export type PnpmLock = (typeof PnpmLockSchema)["Type"];
export type NxProject = (typeof NxProjectSchema)["Type"];
export type NxGraph = (typeof NxGraphSchema)["Type"];
export type CandidatePackOwner = (typeof CandidatePackOwnerSchema)["Type"];
export type TarPackageMetadata = (typeof TarPackageMetadataSchema)["Type"];
export type ReleaseReceiptProjection = (typeof ReleaseReceiptProjectionSchema)["Type"];
export declare const decodeManifestMetadata: (input: unknown) => Result.Result<{
    readonly schemaVersion: 3;
    readonly command: readonly [string, ...string[]];
    readonly artifacts: readonly string[];
    readonly batch: string;
    readonly areas: readonly ["eval" | "cli" | "inspection" | "insight" | "record" | "package" | "runner" | "adapter" | "sandbox" | "lifecycle", ...("eval" | "cli" | "inspection" | "insight" | "record" | "package" | "runner" | "adapter" | "sandbox" | "lifecycle")[]];
    readonly lanes: readonly ["pr" | "main" | "nightly" | "release", ...("pr" | "main" | "nightly" | "release")[]];
    readonly executor: {
        readonly kind: "host";
    };
    readonly timeoutMinutes: number;
    readonly secrets: readonly string[];
    readonly requires?: {
        readonly docker?: boolean | undefined;
        readonly externalNetwork?: boolean | undefined;
        readonly platforms?: readonly ("linux" | "darwin")[] | undefined;
        readonly runtimes?: readonly string[] | undefined;
        readonly browsers?: readonly ("chromium" | "firefox" | "webkit")[] | undefined;
        readonly hostCapabilities?: readonly "linux-loop-project-quota"[] | undefined;
    } | undefined;
    readonly harness?: {
        readonly testkit?: boolean | undefined;
        readonly assets?: readonly "docker-profile-host-scripts"[] | undefined;
    } | undefined;
}, ContractDecodeError>;
export declare const decodeManifest: (input: unknown) => Result.Result<{
    readonly schemaVersion: 3;
    readonly command: readonly [string, ...string[]];
    readonly artifacts: readonly string[];
    readonly batch: string;
    readonly areas: readonly ["eval" | "cli" | "inspection" | "insight" | "record" | "package" | "runner" | "adapter" | "sandbox" | "lifecycle", ...("eval" | "cli" | "inspection" | "insight" | "record" | "package" | "runner" | "adapter" | "sandbox" | "lifecycle")[]];
    readonly lanes: readonly ["pr" | "main" | "nightly" | "release", ...("pr" | "main" | "nightly" | "release")[]];
    readonly executor: {
        readonly kind: "host";
    };
    readonly timeoutMinutes: number;
    readonly secrets: readonly string[];
    readonly id: string;
    readonly requires?: {
        readonly docker?: boolean | undefined;
        readonly externalNetwork?: boolean | undefined;
        readonly platforms?: readonly ("linux" | "darwin")[] | undefined;
        readonly runtimes?: readonly string[] | undefined;
        readonly browsers?: readonly ("chromium" | "firefox" | "webkit")[] | undefined;
        readonly hostCapabilities?: readonly "linux-loop-project-quota"[] | undefined;
    } | undefined;
    readonly harness?: {
        readonly testkit?: boolean | undefined;
        readonly assets?: readonly "docker-profile-host-scripts"[] | undefined;
    } | undefined;
}, ContractDecodeError>;
export declare const decodePlanRange: (input: unknown) => Result.Result<{
    readonly base: string;
    readonly head: string;
}, ContractDecodeError>;
export declare const decodePlanEntry: (input: unknown) => Result.Result<{
    readonly batch: string;
    readonly executor: {
        readonly kind: "host";
    };
    readonly id: string;
    readonly repoIds: readonly [string, ...string[]];
    readonly dirs: readonly [string, ...string[]];
    readonly capabilities: readonly ["eval" | "cli" | "inspection" | "insight" | "record" | "package" | "runner" | "adapter" | "sandbox" | "lifecycle", ...("eval" | "cli" | "inspection" | "insight" | "record" | "package" | "runner" | "adapter" | "sandbox" | "lifecycle")[]];
    readonly shard: string;
    readonly requires?: {
        readonly docker?: boolean | undefined;
        readonly externalNetwork?: boolean | undefined;
        readonly platforms?: readonly ("linux" | "darwin")[] | undefined;
        readonly runtimes?: readonly string[] | undefined;
        readonly browsers?: readonly ("chromium" | "firefox" | "webkit")[] | undefined;
        readonly hostCapabilities?: readonly "linux-loop-project-quota"[] | undefined;
    } | undefined;
    readonly dir?: string | undefined;
}, ContractDecodeError>;
export declare const decodePlanDocument: (input: unknown) => Result.Result<{
    readonly reason: string;
    readonly mode: "affected" | "full" | "fail-open-full";
    readonly graph: {
        readonly selector: "nx show projects --affected --with-target e2e";
        readonly nxVersion: string;
        readonly affectedProjectNames: readonly string[];
        readonly selectedE2EProjectNames: readonly string[];
        readonly e2eProjectNames: readonly string[];
    };
    readonly lane: "pr" | "main" | "nightly" | "release";
    readonly changedPaths: readonly string[];
    readonly projectIds: readonly string[];
    readonly cells: readonly {
        readonly batch: string;
        readonly executor: {
            readonly kind: "host";
        };
        readonly id: string;
        readonly repoIds: readonly [string, ...string[]];
        readonly dirs: readonly [string, ...string[]];
        readonly capabilities: readonly ["eval" | "cli" | "inspection" | "insight" | "record" | "package" | "runner" | "adapter" | "sandbox" | "lifecycle", ...("eval" | "cli" | "inspection" | "insight" | "record" | "package" | "runner" | "adapter" | "sandbox" | "lifecycle")[]];
        readonly shard: string;
        readonly requires?: {
            readonly docker?: boolean | undefined;
            readonly externalNetwork?: boolean | undefined;
            readonly platforms?: readonly ("linux" | "darwin")[] | undefined;
            readonly runtimes?: readonly string[] | undefined;
            readonly browsers?: readonly ("chromium" | "firefox" | "webkit")[] | undefined;
            readonly hostCapabilities?: readonly "linux-loop-project-quota"[] | undefined;
        } | undefined;
        readonly dir?: string | undefined;
    }[];
    readonly detail?: string | undefined;
    readonly range?: {
        readonly base: string;
        readonly head: string;
    } | undefined;
}, ContractDecodeError>;
export declare const decodeInvalidPlanOutput: (input: unknown) => Result.Result<{
    readonly mode: "invalid";
    readonly reason: "invalid-plan";
    readonly detail: string;
    readonly cells: readonly [];
    readonly projectIds: readonly [];
    readonly changedPaths: readonly [];
}, ContractDecodeError>;
export declare const decodePlanRunCell: (input: unknown) => Result.Result<{
    readonly batch: string;
    readonly executor: {
        readonly kind: "host";
    };
    readonly id: string;
    readonly repoIds: readonly [string, ...string[]];
    readonly dirs: readonly [string, ...string[]];
    readonly requires?: {
        readonly docker?: boolean | undefined;
        readonly externalNetwork?: boolean | undefined;
        readonly platforms?: readonly ("linux" | "darwin")[] | undefined;
        readonly runtimes?: readonly string[] | undefined;
        readonly browsers?: readonly ("chromium" | "firefox" | "webkit")[] | undefined;
        readonly hostCapabilities?: readonly "linux-loop-project-quota"[] | undefined;
    } | undefined;
}, ContractDecodeError>;
export declare const decodeSelectionReceipt: (input: unknown) => Result.Result<{
    readonly reason: string;
    readonly mode: "affected" | "full" | "fail-open-full";
    readonly lane: "pr" | "main" | "nightly" | "release";
    readonly cellId: string;
    readonly range?: {
        readonly base: string;
        readonly head: string;
    } | undefined;
}, ContractDecodeError>;
export declare const decodeCommandCapture: (input: unknown) => Result.Result<{
    readonly cancelled: boolean;
    readonly exitCode: number | null;
    readonly signal: string | null;
    readonly timedOut: boolean;
    readonly stdout: string;
    readonly stderr: string;
    readonly processGroupOwned: boolean;
    readonly groupCleanup: {
        readonly detail: string;
        readonly aliveAfterLeaderClose: boolean | null;
        readonly gone: boolean | null;
        readonly owned: boolean;
        readonly checked: boolean;
        readonly signalsSent: readonly string[];
        readonly groupId?: number | undefined;
    };
    readonly error?: string | undefined;
}, ContractDecodeError>;
export declare const decodeCapabilityCheck: (input: unknown) => Result.Result<{
    readonly detail: string;
    readonly kind: "browser" | "docker" | "externalNetwork" | "platform" | "runtime" | "secret" | "hostCapability";
    readonly subject: string;
    readonly ok: boolean;
    readonly command?: readonly string[] | undefined;
    readonly verification?: "checked" | "declared-unverified" | undefined;
    readonly failureCategory?: "infra" | "configuration" | undefined;
    readonly capture?: {
        readonly cancelled: boolean;
        readonly exitCode: number | null;
        readonly signal: string | null;
        readonly timedOut: boolean;
        readonly stdout: string;
        readonly stderr: string;
        readonly processGroupOwned: boolean;
        readonly groupCleanup: {
            readonly detail: string;
            readonly aliveAfterLeaderClose: boolean | null;
            readonly gone: boolean | null;
            readonly owned: boolean;
            readonly checked: boolean;
            readonly signalsSent: readonly string[];
            readonly groupId?: number | undefined;
        };
        readonly error?: string | undefined;
    } | undefined;
}, ContractDecodeError>;
export declare const decodeStageReceipt: (input: unknown) => Result.Result<{
    readonly ok: boolean;
    readonly stage: "preflight" | "prepare" | "install" | "injection" | "browser" | "test" | "collect" | "cleanup";
    readonly detail?: string | undefined;
    readonly cancelled?: boolean | undefined;
    readonly assets?: readonly "docker-profile-host-scripts"[] | undefined;
    readonly command?: readonly string[] | undefined;
    readonly failureCategory?: "infra" | "configuration" | undefined;
    readonly capture?: {
        readonly cancelled: boolean;
        readonly exitCode: number | null;
        readonly signal: string | null;
        readonly timedOut: boolean;
        readonly stdout: string;
        readonly stderr: string;
        readonly processGroupOwned: boolean;
        readonly groupCleanup: {
            readonly detail: string;
            readonly aliveAfterLeaderClose: boolean | null;
            readonly gone: boolean | null;
            readonly owned: boolean;
            readonly checked: boolean;
            readonly signalsSent: readonly string[];
            readonly groupId?: number | undefined;
        };
        readonly error?: string | undefined;
    } | undefined;
    readonly attempt?: number | undefined;
    readonly invocationId?: string | undefined;
    readonly checks?: readonly {
        readonly detail: string;
        readonly kind: "browser" | "docker" | "externalNetwork" | "platform" | "runtime" | "secret" | "hostCapability";
        readonly subject: string;
        readonly ok: boolean;
        readonly command?: readonly string[] | undefined;
        readonly verification?: "checked" | "declared-unverified" | undefined;
        readonly failureCategory?: "infra" | "configuration" | undefined;
        readonly capture?: {
            readonly cancelled: boolean;
            readonly exitCode: number | null;
            readonly signal: string | null;
            readonly timedOut: boolean;
            readonly stdout: string;
            readonly stderr: string;
            readonly processGroupOwned: boolean;
            readonly groupCleanup: {
                readonly detail: string;
                readonly aliveAfterLeaderClose: boolean | null;
                readonly gone: boolean | null;
                readonly owned: boolean;
                readonly checked: boolean;
                readonly signalsSent: readonly string[];
                readonly groupId?: number | undefined;
            };
            readonly error?: string | undefined;
        } | undefined;
    }[] | undefined;
    readonly collected?: readonly string[] | undefined;
    readonly path?: string | undefined;
}, ContractDecodeError>;
export declare const decodeCandidateIdentity: (input: unknown) => Result.Result<{
    readonly sha256: string;
    readonly integrity: string;
    readonly reproduce: string;
    readonly exactReplay: boolean;
    readonly artifactPath?: string | undefined;
}, ContractDecodeError>;
export declare const decodeTestkitReceipt: (input: unknown) => Result.Result<{
    readonly version: string;
    readonly sourcePath: "packages/testkit";
    readonly resolvedPath: string;
    readonly digest: string;
}, ContractDecodeError>;
export declare const decodeRepoReceipt: (input: unknown) => Result.Result<{
    readonly detail: string;
    readonly exitCode: number | null;
    readonly stages: readonly {
        readonly ok: boolean;
        readonly stage: "preflight" | "prepare" | "install" | "injection" | "browser" | "test" | "collect" | "cleanup";
        readonly detail?: string | undefined;
        readonly cancelled?: boolean | undefined;
        readonly assets?: readonly "docker-profile-host-scripts"[] | undefined;
        readonly command?: readonly string[] | undefined;
        readonly failureCategory?: "infra" | "configuration" | undefined;
        readonly capture?: {
            readonly cancelled: boolean;
            readonly exitCode: number | null;
            readonly signal: string | null;
            readonly timedOut: boolean;
            readonly stdout: string;
            readonly stderr: string;
            readonly processGroupOwned: boolean;
            readonly groupCleanup: {
                readonly detail: string;
                readonly aliveAfterLeaderClose: boolean | null;
                readonly gone: boolean | null;
                readonly owned: boolean;
                readonly checked: boolean;
                readonly signalsSent: readonly string[];
                readonly groupId?: number | undefined;
            };
            readonly error?: string | undefined;
        } | undefined;
        readonly attempt?: number | undefined;
        readonly invocationId?: string | undefined;
        readonly checks?: readonly {
            readonly detail: string;
            readonly kind: "browser" | "docker" | "externalNetwork" | "platform" | "runtime" | "secret" | "hostCapability";
            readonly subject: string;
            readonly ok: boolean;
            readonly command?: readonly string[] | undefined;
            readonly verification?: "checked" | "declared-unverified" | undefined;
            readonly failureCategory?: "infra" | "configuration" | undefined;
            readonly capture?: {
                readonly cancelled: boolean;
                readonly exitCode: number | null;
                readonly signal: string | null;
                readonly timedOut: boolean;
                readonly stdout: string;
                readonly stderr: string;
                readonly processGroupOwned: boolean;
                readonly groupCleanup: {
                    readonly detail: string;
                    readonly aliveAfterLeaderClose: boolean | null;
                    readonly gone: boolean | null;
                    readonly owned: boolean;
                    readonly checked: boolean;
                    readonly signalsSent: readonly string[];
                    readonly groupId?: number | undefined;
                };
                readonly error?: string | undefined;
            } | undefined;
        }[] | undefined;
        readonly collected?: readonly string[] | undefined;
        readonly path?: string | undefined;
    }[];
    readonly repoId: string;
    readonly invocationIds: readonly [string, ...string[]];
    readonly testInvocations: number;
    readonly artifactDir: string;
    readonly receiptPath: string;
    readonly category: "pass" | "regression" | "infra" | "configuration" | "cancelled";
    readonly candidate: {
        readonly sha256: string;
        readonly integrity: string;
        readonly reproduce: string;
        readonly exactReplay: boolean;
        readonly artifactPath?: string | undefined;
    };
    readonly testkit?: {
        readonly version: string;
        readonly sourcePath: "packages/testkit";
        readonly resolvedPath: string;
        readonly digest: string;
    } | undefined;
    readonly selection?: {
        readonly reason: string;
        readonly mode: "affected" | "full" | "fail-open-full";
        readonly lane: "pr" | "main" | "nightly" | "release";
        readonly cellId: string;
        readonly range?: {
            readonly base: string;
            readonly head: string;
        } | undefined;
    } | undefined;
    readonly copyId?: string | undefined;
    readonly runLabel?: string | undefined;
    readonly sourceSnapshotDigest?: string | undefined;
}, ContractDecodeError>;
export declare const decodeRunSummary: (input: unknown) => Result.Result<{
    readonly detail: string;
    readonly runner: {
        readonly category: "pass" | "infra";
        readonly detail: string;
        readonly scratchDisposition: {
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
    };
    readonly regression: number;
    readonly infra: number;
    readonly configuration: number;
    readonly cancelled: number;
    readonly category: "pass" | "regression" | "infra" | "configuration" | "cancelled";
    readonly artifactRoot: string;
    readonly summaryPath: string;
    readonly results: readonly {
        readonly id: string;
        readonly exitCode: number | null;
        readonly category: "pass" | "regression" | "infra" | "configuration" | "cancelled";
        readonly detail: string;
        readonly artifactDir: string;
        readonly receiptPath: string;
    }[];
    readonly passed: number;
    readonly total: number;
    readonly selection?: {
        readonly reason: string;
        readonly mode: "affected" | "full" | "fail-open-full";
        readonly lane: "pr" | "main" | "nightly" | "release";
        readonly cellId: string;
        readonly range?: {
            readonly base: string;
            readonly head: string;
        } | undefined;
    } | undefined;
}, ContractDecodeError>;
export declare const decodePackageJson: (input: unknown) => Result.Result<{
    readonly version?: string | undefined;
    readonly name?: string | undefined;
    readonly dependencies?: {
        readonly [x: string]: unknown;
    } | undefined;
    readonly devDependencies?: {
        readonly [x: string]: unknown;
    } | undefined;
    readonly optionalDependencies?: {
        readonly [x: string]: unknown;
    } | undefined;
    readonly peerDependencies?: {
        readonly [x: string]: unknown;
    } | undefined;
    readonly exports?: unknown;
}, ContractDecodeError>;
export declare const decodeTestkitPackage: (input: unknown) => Result.Result<{
    readonly path: string;
    readonly sourcePath: "packages/testkit";
    readonly name: "@niceeval/testkit";
    readonly version: string;
    readonly digest: string;
}, ContractDecodeError>;
export declare const decodePnpmLock: (input: unknown) => Result.Result<{
    readonly lockfileVersion?: string | number | undefined;
    readonly importers?: {
        readonly [x: string]: unknown;
    } | undefined;
    readonly packages?: {
        readonly [x: string]: unknown;
    } | undefined;
    readonly snapshots?: {
        readonly [x: string]: unknown;
    } | undefined;
}, ContractDecodeError>;
export declare const decodeNxProject: (input: unknown) => Result.Result<{
    readonly data: {
        readonly root: string;
        readonly tags?: readonly string[] | undefined;
        readonly targets?: {
            readonly [x: string]: unknown;
        } | undefined;
    };
}, ContractDecodeError>;
export declare const decodeNxGraph: (input: unknown) => Result.Result<{
    readonly graph: {
        readonly nodes: {
            readonly [x: string]: {
                readonly data: {
                    readonly root: string;
                    readonly tags?: readonly string[] | undefined;
                    readonly targets?: {
                        readonly [x: string]: unknown;
                    } | undefined;
                };
            };
        };
        readonly dependencies: {
            readonly [x: string]: readonly {
                readonly source: string;
                readonly target: string;
            }[];
        };
    };
}, ContractDecodeError>;
export declare const decodeCandidatePackOwner: (input: unknown) => Result.Result<{
    readonly token: string;
    readonly pid: number;
    readonly host: string;
    readonly createdAtMs: number;
    readonly heartbeatAtMs: number;
}, ContractDecodeError>;
export declare const decodeTarPackageMetadata: (input: unknown) => Result.Result<{
    readonly name: string;
    readonly version: string;
}, ContractDecodeError>;
export declare const decodeReleaseReceiptProjection: (input: unknown) => Result.Result<{
    readonly repoId?: string | undefined;
    readonly category?: "pass" | "regression" | "infra" | "configuration" | "cancelled" | undefined;
    readonly candidate?: {
        readonly artifactPath?: string | undefined;
        readonly sha256?: string | undefined;
        readonly integrity?: string | undefined;
        readonly exactReplay?: boolean | undefined;
    } | undefined;
}, ContractDecodeError>;
export {};
