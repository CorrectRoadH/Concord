import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from 'node:child_process';
import { Context, Effect, FileSystem, Layer } from "effect";
import { type IssueClosure, type IssueMemoryRelation, type IssueMeta } from "concord-sdlc/model";
import { compileTraceUnderLease } from "../docs/trace/compiler.js";
import type { TraceError } from "../docs/trace/errors.js";
import type { RepoRef } from "../docs/trace/ref.js";
import { mutateTraceFiles, traceDigest, type TraceCoordinationError, type TraceMultiFileReceipt, withTraceReadLease } from "../docs/trace/relation-mutation.js";
import { FeedbackContentInvalid } from "./errors.js";
import type { FeedbackDocument } from "./codec.js";
import type { FeedbackError } from "./errors.js";
import { feedbackEffect, FeedbackRepository, type FeedbackCheckReceipt } from "./repository.js";
import type { FeedbackEnvelopeV1 } from "./schema.js";
import { leafOwnerSelection, assertSameLeafSelection } from '../document-owners.js';

export interface FeedbackMutationChanges {
  readonly created?: boolean;
  readonly memoryRelationAdded?: IssueMemoryRelation;
  readonly adoptionAdded?: RepoRef;
  readonly adoptionRetired?: { readonly target: RepoRef; readonly commit: string };
  readonly state?: { readonly from: "draft" | "closed"; readonly to: "draft" | "closed" };
}
export type FeedbackMutationReceipt = Omit<TraceMultiFileReceipt, 'committed'> & { readonly committed: boolean; readonly value: IssueMeta; readonly changes: FeedbackMutationChanges };
export type FeedbackStoreError = FeedbackError | TraceError | TraceCoordinationError;
export interface FeedbackStoreService {
  readonly list: () => Effect.Effect<readonly FeedbackDocument[], FeedbackStoreError>;
  readonly read: (id: string) => Effect.Effect<FeedbackDocument, FeedbackStoreError>;
  readonly create: (document: FeedbackDocument, dryRun: boolean) => Effect.Effect<FeedbackMutationReceipt, FeedbackStoreError, FileSystem.FileSystem>;
  readonly importEnvelope: (envelope: FeedbackEnvelopeV1, artifactRoot: string, reportedAt: string, dryRun: boolean) => Effect.Effect<FeedbackMutationReceipt, FeedbackStoreError, FileSystem.FileSystem>;
  readonly link: (id: string, relation: IssueMemoryRelation, dryRun: boolean) => Effect.Effect<FeedbackMutationReceipt, FeedbackStoreError, FileSystem.FileSystem>;
  readonly adopt: (id: string, target: RepoRef, dryRun: boolean) => Effect.Effect<FeedbackMutationReceipt, FeedbackStoreError, FileSystem.FileSystem>;
  readonly retire: (id: string, target: RepoRef, dryRun: boolean) => Effect.Effect<FeedbackMutationReceipt, FeedbackStoreError, FileSystem.FileSystem>;
  readonly close: (id: string, closure: IssueClosure, dryRun: boolean) => Effect.Effect<FeedbackMutationReceipt, FeedbackStoreError, FileSystem.FileSystem>;
  readonly reopen: (id: string, dryRun: boolean) => Effect.Effect<FeedbackMutationReceipt, FeedbackStoreError, FileSystem.FileSystem>;
  readonly check: () => Effect.Effect<FeedbackCheckReceipt, FeedbackStoreError, FileSystem.FileSystem>;
}
export class FeedbackStore extends Context.Service<FeedbackStore, FeedbackStoreService>()("concord/feedback/Store") {}

export const NodeFeedbackStoreLive = (root: string) => Layer.succeed(FeedbackStore, (() => {
  const repository = new FeedbackRepository({ root });
  const headCommit = (): string => {
    const env = { ...process.env }; for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
    return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { env, encoding: 'utf8' }).trim();
  };
  const dryReceipt = (path: string, bytes: string, value: IssueMeta, changes: FeedbackMutationChanges, generation: number): FeedbackMutationReceipt => ({ format: "concord.docs-trace/multi-file-mutation/v1", transactionId: "dry-run", generationBefore: generation, generationAfter: generation, preimages: [{ path, digest: existsSync(repository.safePath(path)) ? traceDigest(readFileSync(repository.safePath(path), "utf8")) : null }], plannedDigests: [{ path, digest: traceDigest(bytes) }], committed: false, value, changes });
  const mutate = (id: string, operation: string, dryRun: boolean, plan: (source: string | undefined, at: string, commit: string) => { readonly bytes: string; readonly value: IssueMeta; readonly changes: FeedbackMutationChanges }): Effect.Effect<FeedbackMutationReceipt, FeedbackStoreError, FileSystem.FileSystem> => Effect.gen(function*() {
    const frozen = yield* withTraceReadLease(root, () => feedbackEffect(operation, () => leafOwnerSelection(root, 'issue', id)));
    const owner = frozen.path;
    let plannedValue: IssueMeta | undefined;
    let plannedChanges: FeedbackMutationChanges = {};
    let plannedBytes = ''; let generation = 0;
    const prepare = compileTraceUnderLease(root).pipe(Effect.flatMap((snapshot) => feedbackEffect(operation, () => {
      assertSameLeafSelection(root, 'issue', id, frozen);
      const path = repository.safePath(owner); const source = existsSync(path) ? readFileSync(path, "utf8") : undefined; const planned = plan(source, new Date().toISOString(), headCommit()); plannedValue = planned.value; plannedChanges = planned.changes;
      repository.validateIssue(planned.value, snapshot); plannedBytes = planned.bytes; generation = snapshot.generation;
      const refs = [...planned.value.memoryRelations.map(relation => relation.memory), ...planned.value.adoptions.current];
      const closure = planned.value.closure;
      if (closure && 'memory' in closure) refs.push(closure.memory);
      if (closure?.kind === 'duplicate') refs.push(closure.canonical);
      if (closure?.kind === 'delivered') refs.push(closure.target);
      const guards = [...new Set(refs.map(ref => ref.split('#')[0]!))].filter(ref => ref !== owner).map(ref => { const target = repository.targetSource(ref); return { path: ref, bytes: target.source, expectedDigest: traceDigest(target.source) }; });
      return [{ path: owner, bytes: planned.bytes, expectedDigest: source === undefined ? null : traceDigest(source) }, ...guards];
    })));
    if (dryRun) return yield* withTraceReadLease(root, () => prepare.pipe(Effect.map(() => dryReceipt(owner, plannedBytes, plannedValue!, plannedChanges, generation))));
    return yield* mutateTraceFiles({ root, operation, prepareUnderLease: prepare }).pipe(Effect.map((receipt) => {
      return { ...receipt, value: plannedValue!, changes: plannedChanges };
    }));
  });
  const create = (document: FeedbackDocument, dryRun: boolean) => mutate(document.metadata.id, "issue-add", dryRun, () => { const planned = repository.planCreate(document); return { bytes: planned.bytes, value: planned.metadata, changes: { created: true } }; });
  return {
    list: () => withTraceReadLease(root, () => feedbackEffect("list", () => repository.list())),
    read: (id) => withTraceReadLease(root, () => feedbackEffect("read", () => repository.read(id))),
    create,
    importEnvelope: (envelope, artifactRoot, reportedAt, dryRun) => {
      let value: IssueMeta | undefined; let bytes = ''; let generation = 0;
      const prepare = compileTraceUnderLease(root).pipe(Effect.flatMap(snapshot => feedbackEffect('import', () => {
        const prepared = repository.prepareImport(envelope, artifactRoot, reportedAt);
        value = prepared.document.metadata; bytes = prepared.document.body; generation = snapshot.generation;
        repository.validateIssue(value, snapshot);
        if (prepared.files.length > 0) return prepared.files;
        const path = repository.ownerPath(value.id); const source = readFileSync(repository.safePath(path), 'utf8');
        return [{ path, bytes: source, expectedDigest: traceDigest(source) }];
      })));
      if (dryRun) return withTraceReadLease(root, () => prepare.pipe(Effect.map(files => ({ ...dryReceipt(repository.ownerPath(value!.id), bytes, value!, { created: !existsSync(repository.absoluteOwnerPath(value!.id)) }, generation), plannedDigests: files.map(file => ({ path: file.path, digest: file.bytes === null ? null : traceDigest(file.bytes) })) }))));
      return mutateTraceFiles({ root, operation: 'issue-import', prepareUnderLease: prepare }).pipe(Effect.map(receipt => ({ ...receipt, value: value!, changes: {} })));
    },
    link: (id, relation, dryRun) => mutate(id, "issue-link", dryRun, (source, at) => { if (source === undefined) throw new FeedbackContentInvalid({ operation: "link", path: repository.ownerPath(id), message: "Issue not found" }); const planned = repository.planLink(id, source, relation); return { bytes: planned.bytes, value: planned.metadata, changes: { memoryRelationAdded: relation } }; }),
    adopt: (id, target, dryRun) => mutate(id, "issue-adopt", dryRun, (source) => { const planned = repository.planAdopt(id, source, target); return { bytes: planned.bytes, value: planned.metadata, changes: { adoptionAdded: target } }; }),
    retire: (id, target, dryRun) => mutate(id, "issue-retire", dryRun, (source, _at, commit) => { const planned = repository.planRetire(id, source, target, commit); return { bytes: planned.bytes, value: planned.metadata, changes: { adoptionRetired: { target, commit } } }; }),
    close: (id, closure, dryRun) => mutate(id, "issue-close", dryRun, (source, at) => { const planned = repository.planClose(id, source, closure, at, "close Issue"); return { bytes: planned.bytes, value: planned.metadata, changes: { state: { from: "draft", to: "closed" } } }; }),
    reopen: (id, dryRun) => mutate(id, "issue-reopen", dryRun, (source, at) => { const planned = repository.planReopen(id, source, at, "reopen Issue"); return { bytes: planned.bytes, value: planned.metadata, changes: { state: { from: "closed", to: "draft" } } }; }),
    check: () => withTraceReadLease(root, () => compileTraceUnderLease(root).pipe(Effect.flatMap((snapshot) => feedbackEffect("check", () => repository.check(snapshot))))),
  } satisfies FeedbackStoreService;
})());
