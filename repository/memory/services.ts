import { managedInventoryImplementationDigest } from "../host.js";
import { readGovernanceConfiguration } from "concord-sdlc/governance-config";
import { Context, Effect, FileSystem, Layer } from "effect";

import { compileTrace, compileTraceUnderLease } from "../docs/trace/compiler.js";
import type { TraceError } from "../docs/trace/errors.js";
import type { RepoRef } from "../docs/trace/ref.js";
import {
  mutateTraceOwner,
  traceDigest,
  type TraceCoordinationError,
  type TraceMutationPreparation,
  type TraceMutationReceipt,
  withTraceReadLease,
} from "../docs/trace/relation-mutation.js";
import { decodeMemoryDocument } from "./codec.js";
import { MemoryReferenceConflict, type MemoryError } from "./errors.js";
import { memoryEffect, MemoryRepository, type MemoryAuthorSnapshot, type MemoryCheckReceipt } from "./repository.js";
import type { MemoryDocument, MemoryMeta, ProblemResolutionIntent, PromotionKind } from "./schema.js";

export interface MemoryMutationChanges {
  readonly created?: boolean;
  readonly authorUpdated?: boolean;
  readonly state?: { readonly from: string; readonly to: string };
  readonly promotionAdded?: { readonly kind: PromotionKind; readonly target: RepoRef };
  readonly promotionRetired?: { readonly kind: PromotionKind; readonly target: RepoRef; readonly commit: string };
  readonly supersededBy?: string;
  readonly retiredBySupersede?: readonly { readonly kind: PromotionKind; readonly target: RepoRef; readonly commit: string }[];
}

export type MemoryMutationReceipt = TraceMutationReceipt<MemoryMeta, MemoryMutationChanges>;
export type MemoryStoreError = MemoryError | TraceError | TraceCoordinationError;

export interface MemoryStoreService {
  readonly list: () => Effect.Effect<readonly MemoryDocument[], MemoryStoreError>;
  readonly read: (id: string) => Effect.Effect<MemoryDocument, MemoryStoreError>;
  readonly readAuthor: (id: string) => Effect.Effect<MemoryAuthorSnapshot, MemoryStoreError>;
  readonly search: (pattern: string) => Effect.Effect<readonly MemoryDocument[], MemoryStoreError>;
  readonly create: (metadata: MemoryMeta, body: string, dryRun: boolean) => Effect.Effect<MemoryMutationReceipt, MemoryStoreError, FileSystem.FileSystem>;
  readonly setAuthor: (id: string, body: string, expectedOwnerDigest: string, expectedAuthorDigest: string, dryRun: boolean) => Effect.Effect<MemoryMutationReceipt, MemoryStoreError, FileSystem.FileSystem>;
  readonly resolve: (id: string, resolution: ProblemResolutionIntent, dryRun: boolean) => Effect.Effect<MemoryMutationReceipt, MemoryStoreError, FileSystem.FileSystem>;
  readonly activate: (id: string, reason: string, dryRun: boolean) => Effect.Effect<MemoryMutationReceipt, MemoryStoreError, FileSystem.FileSystem>;
  readonly reopen: (id: string, dryRun: boolean) => Effect.Effect<MemoryMutationReceipt, MemoryStoreError, FileSystem.FileSystem>;
  readonly supersede: (id: string, replacementId: string, dryRun: boolean) => Effect.Effect<MemoryMutationReceipt, MemoryStoreError, FileSystem.FileSystem>;
  readonly promote: (id: string, target: RepoRef, dryRun: boolean) => Effect.Effect<MemoryMutationReceipt, MemoryStoreError, FileSystem.FileSystem>;
  readonly retire: (id: string, target: RepoRef, dryRun: boolean) => Effect.Effect<MemoryMutationReceipt, MemoryStoreError, FileSystem.FileSystem>;
  readonly check: () => Effect.Effect<MemoryCheckReceipt, MemoryStoreError, FileSystem.FileSystem>;
}

export class MemoryStore extends Context.Service<MemoryStore, MemoryStoreService>()("@concord/repository/memory/Store") {}

/** Node filesystem adapter; applications provide it once at their composition edge. */
export const NodeMemoryStoreLive = (root: string) => Layer.succeed(MemoryStore, (() => {
  const repository = new MemoryRepository(root);

  const prepareUnderLease = (
    target?: RepoRef,
    extraPaths: readonly string[] = [],
    regressionMemory?: string,
    validatedAt?: string,
  ): Effect.Effect<TraceMutationPreparation, MemoryStoreError, FileSystem.FileSystem> =>
    Effect.gen(function*() {
      const snapshot = yield* compileTraceUnderLease(root);
      const implementationDigest = regressionMemory === undefined ? undefined : yield* managedInventoryImplementationDigest(root).pipe(Effect.mapError(cause => new MemoryReferenceConflict({ operation: "resolve", message: cause.message })));
      const prepared = yield* memoryEffect("trace preparation", () => {
        const regressionTarget = regressionMemory === undefined ? undefined : `memory/${regressionMemory}.md`;
        const fixedEvidence = regressionTarget === undefined
          ? { selectors: [] as readonly string[], preimagePaths: [] as readonly string[], preimageDigests: {} as Readonly<Record<string, string>>, evidence: undefined }
          : repository.validateFixedEvidence(snapshot, regressionTarget, { ...(implementationDigest === undefined ? {} : { implementationDigest }), ...(validatedAt === undefined ? {} : { validatedAt }) });
        const governance = readGovernanceConfiguration(root);
        const policyPaths = governance === undefined ? [] : [governance.path, ...(governance.config.host === undefined ? [] : [governance.config.host])];
        const guardedPaths = [...new Set([...extraPaths, ...fixedEvidence.preimagePaths, ...policyPaths])].sort();
        const extra = guardedPaths.map((path) => {
          const source = repository.targetSource(path);
          const actual = traceDigest(source.source);
          const expected = fixedEvidence.preimageDigests[path];
          if (expected !== undefined && actual !== expected) throw new MemoryReferenceConflict({ operation: "resolve", path, message: "evidence dependency changed after validation" });
          if (governance !== undefined && path === governance.path && actual !== governance.digest) throw new MemoryReferenceConflict({ operation: "mutate", path, message: "policy configuration changed during preparation" });
          return { path: source.absolutePath, digest: actual };
        });
        const evidence = regressionMemory === undefined ? {} : { regressionOwners: fixedEvidence.selectors, regressionMemoryEvidence: fixedEvidence.evidence };
        if (target === undefined) return { generation: snapshot.generation, snapshotDigest: snapshot.digest, preimages: extra, ...evidence };
        const source = repository.targetSource(target);
        const validated = repository.validateTarget(snapshot, target);
        return {
          generation: snapshot.generation,
          snapshotDigest: snapshot.digest,
          target: validated,
          preimages: [...extra, { path: source.absolutePath, digest: traceDigest(source.source) }],
          ...evidence,
        };
      });
      if (implementationDigest !== undefined) {
        const current = yield* managedInventoryImplementationDigest(root).pipe(Effect.mapError(cause => new MemoryReferenceConflict({ operation: "resolve", message: cause.message })));
        if (current !== implementationDigest) return yield* Effect.fail(new MemoryReferenceConflict({ operation: "resolve", message: "native implementation changed during evidence validation" }));
      }
      return prepared;
    });

  const mutate = <Changes>(options: {
    readonly id: string;
    readonly operation: string;
    readonly dryRun: boolean;
    readonly target?: RepoRef;
    readonly extraPaths?: readonly string[];
    readonly regressionMemory?: string;
    readonly plan: (
      source: string | undefined,
      commit: string,
      preparation: TraceMutationPreparation,
    ) => { readonly bytes: string; readonly metadata: MemoryMeta; readonly changes: Changes };
  }): Effect.Effect<TraceMutationReceipt<MemoryMeta, Changes>, MemoryStoreError, FileSystem.FileSystem> =>
    Effect.suspend(() => {
      // Both publication preflight passes observe one validation operation.
      const validatedAt = new Date().toISOString();
      return mutateTraceOwner({
        root,
        operation: options.operation,
        ownerPath: repository.ownerPath(options.id),
        dryRun: options.dryRun,
        prepareUnderLease: prepareUnderLease(options.target, options.extraPaths, options.regressionMemory, validatedAt),
        plan: ({ source, headCommit, preparation }) => memoryEffect(options.operation, () => {
          const planned = options.plan(source, headCommit, preparation);
          return { bytes: planned.bytes, value: planned.metadata, changes: planned.changes };
        }),
      });
    });

  return {
    list: () => withTraceReadLease(root, () => memoryEffect("list", () => repository.list())),
    read: (id) => withTraceReadLease(root, () => memoryEffect("read", () => repository.read(id))),
    readAuthor: (id) => withTraceReadLease(root, () => memoryEffect("read author", () => repository.readAuthorSnapshot(id))),
    search: (pattern) => withTraceReadLease(root, () => memoryEffect("search", () => repository.search(pattern))),
    create: (metadata, body, dryRun) => mutate({
      id: metadata.id,
      operation: "memory-add",
      dryRun,
      plan: () => ({ ...repository.planCreate(metadata, body), changes: { created: true } }),
    }),
    setAuthor: (id, body, expectedOwnerDigest, expectedAuthorDigest, dryRun) => mutate({
      id,
      operation: "memory-author-set",
      dryRun,
      plan: (source) => ({
        ...repository.planAuthorSet(id, source, body, expectedOwnerDigest, expectedAuthorDigest),
        changes: { authorUpdated: true },
      }),
    }),
    resolve: (id, resolution, dryRun) => mutate({
      id,
      operation: "memory-resolve",
      dryRun,
      ...(resolution.kind === "fixed" ? { regressionMemory: id } : {}),
      plan: (source, commit, preparation) => ({
        ...repository.planResolve(id, source, resolution, (preparation as TraceMutationPreparation & { readonly regressionMemoryEvidence?: import("concord-sdlc/model").RepositoryEvidence }).regressionMemoryEvidence, commit),
        changes: { state: { from: "open", to: "resolved" } },
      }),
    }),
    activate: (id, reason, dryRun) => mutate({
      id,
      operation: "memory-activate",
      dryRun,
      plan: (source, commit) => {
        const planned = repository.planActivate(id, source, reason, new Date().toISOString(), commit);
        return { ...planned, changes: { state: { from: "captured", to: planned.metadata.state } } };
      },
    }),
    reopen: (id, dryRun) => mutate({
      id,
      operation: "memory-reopen",
      dryRun,
      plan: (source, commit) => ({ ...repository.planReopen(id, source, "reopen", new Date().toISOString(), commit), changes: { state: { from: "resolved", to: "open" } } }),
    }),
    supersede: (id, replacementId, dryRun) => mutate({
      id,
      operation: "memory-supersede",
      dryRun,
      extraPaths: [repository.ownerPath(replacementId)],
      plan: (source, commit) => {
        if (source === undefined) {
          throw new MemoryReferenceConflict({
            operation: "supersede",
            path: repository.ownerPath(id),
            message: "Memory disappeared during supersede planning",
          });
        }
        const replacement = repository.read(replacementId);
        return {
          ...repository.planSupersede(id, source, replacement.metadata, "supersede", new Date().toISOString(), repository.ownerPath(replacementId), commit),
          changes: { supersededBy: repository.ownerPath(replacementId) },
        };
      },
    }),
    promote: (id, target, dryRun) => mutate({
      id,
      operation: "memory-promote",
      dryRun,
      target,
      plan: (source, commit, preparation) => {
        const kind = preparation.target?.kind;
        if (kind !== "roadmap" && kind !== "feature" && kind !== "use-case" && kind !== "engineering") {
          throw new MemoryReferenceConflict({ operation: "promote", message: "promotion target kind was not prepared" });
        }
        return { ...repository.planPromote(id, source, target, new Date().toISOString(), commit), changes: { promotionAdded: { kind, target } } };
      },
    }),
    retire: (id, target, dryRun) => mutate({
      id,
      operation: "memory-retire",
      dryRun,
      target,
      plan: (source, commit, preparation) => {
        const kind = preparation.target?.kind;
        if (kind !== "roadmap" && kind !== "feature" && kind !== "use-case" && kind !== "engineering") {
          throw new MemoryReferenceConflict({ operation: "retire", message: "promotion target kind was not prepared" });
        }
        return {
          ...repository.planRetire(id, source, target, "retire promotion", new Date().toISOString(), commit),
          changes: { promotionRetired: { kind, target, commit } },
        };
      },
    }),
    check: () => withTraceReadLease(root, () => compileTraceUnderLease(root).pipe(
      Effect.flatMap(snapshot => Effect.gen(function*() {
        const memories = yield* memoryEffect("check", () => repository.list());
        const hasNative = memories.some(memory => memory.metadata.resolution?.evidenceLevel === "repository");
        const implementation = hasNative ? yield* managedInventoryImplementationDigest(root).pipe(Effect.catch(() => Effect.succeed(undefined))) : undefined;
        return yield* memoryEffect("check", () => repository.check(snapshot, implementation));
      })),
    )),
  } satisfies MemoryStoreService;
})());
