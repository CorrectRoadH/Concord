import { createHash, randomUUID } from "node:crypto";
import { Context, Effect, Schema } from "effect";
import { IssueAuthorizationMismatch, IssueCreateConflict, IssueInputError, IssueNoChange, IssuePlanConsumed, IssuePlanCorrupt, IssuePlanDrifted, IssuePlanExpired, IssuePlanIoError, IssuePlanNotPlanned, IssueTargetIsPullRequest, type IssueError } from "./errors.js";
import { IssuePlanReceiptSchema, type CreateIdentity, type IssueBinding, type IssueIdentity, type IssueMutationResult, type IssueOperation, type IssueOutcome, type IssuePayload, type IssuePlanReceipt, type IssueRepository, type RemoteIssue } from "./model.js";
const digest = (value: unknown) => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const sameRepository = (left: IssueRepository, right: IssueRepository) => left.host === right.host && left.repository === right.repository;
const issueSnapshot = (issue: RemoteIssue) => ({ number: issue.number, title: issue.title, body: issue.body, state: issue.state, labels: [...issue.labels].sort(), isPullRequest: issue.isPullRequest });
export interface IssueRemoteService {
  readonly verifyRepository: (repository: IssueRepository, repositoryId: string) => Effect.Effect<void, IssueError>;
  readonly list: (repository: IssueRepository, state: "open" | "closed") => Effect.Effect<readonly RemoteIssue[], IssueError>;
  readonly get: (identity: IssueIdentity) => Effect.Effect<RemoteIssue, IssueError>;
  readonly mutate: (receipt: IssuePlanReceipt) => Effect.Effect<IssueMutationResult, IssueError>;
}
export class IssueRemote extends Context.Service<IssueRemote, IssueRemoteService>()("concord/issue/Remote") {}
export interface IssuePlanStoreService {
  readonly plan: (receipt: IssuePlanReceipt) => Effect.Effect<void, IssuePlanCorrupt | IssuePlanIoError>;
  readonly read: (receiptId: string) => Effect.Effect<IssuePlanReceipt, IssuePlanConsumed | IssuePlanNotPlanned | IssuePlanCorrupt | IssuePlanIoError>;
  readonly outcome: (receipt: IssuePlanReceipt, outcome: IssueOutcome) => Effect.Effect<void, IssuePlanIoError>;
  readonly consume: (receipt: IssuePlanReceipt, now: number) => Effect.Effect<void, IssuePlanConsumed | IssuePlanExpired | IssuePlanNotPlanned | IssuePlanCorrupt | IssuePlanIoError>;
}
export class IssuePlanStore extends Context.Service<IssuePlanStore, IssuePlanStoreService>()("concord/issue/PlanStore") {}
export const issueTarget = (receipt: IssuePlanReceipt): string => `${receipt.repository.repository}${"number" in receipt.identity ? `#${receipt.identity.number}` : ""}`;
export const issueAuthorization = (receipt: IssuePlanReceipt): string => `${receipt.operation}:${issueTarget(receipt)}@${receipt.payloadDigest.slice(7, 19)}`;
export const planIssueMutation = (identity: IssueIdentity | CreateIdentity, operation: IssueOperation, payload: IssuePayload, remotePreimageDigest: string, now: number, binding: IssueBinding): IssuePlanReceipt => ({
  format: "concord.issue-plan/v1", id: randomUUID(), schema: 1, plannedAt: now, expiresAt: now + 5 * 60_000, operation,
  connection: binding.connection, repositoryId: binding.repositoryId,
  repository: { host: identity.host, repository: identity.repository }, identity, remotePreimageDigest, payloadDigest: digest(payload), payload,
});
export const remoteIssueDigest = (issue: RemoteIssue): string => digest(issueSnapshot(issue));
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const originMatches = (issue: RemoteIssue, originKey: string) => new RegExp(`^origin-key: ${escapeRegExp(originKey)}\\s*$`, "mu").test(issue.body);
export const remoteCreateDigest = (issues: readonly RemoteIssue[], identity: CreateIdentity, payload: Extract<IssuePayload, { operation: "create" }>): string => digest(issues.filter(issue => !issue.isPullRequest && (identity.kind === "machine-origin" ? originMatches(issue, identity.originKey!) : issue.title === payload.title)).map(issueSnapshot).sort((a, b) => a.number - b.number));
export const listIssues = Effect.fn("Issue.list")(function*(repository: IssueRepository) {
  const remote = yield* IssueRemote;
  const open = yield* remote.list(repository, "open");
  const closed = yield* remote.list(repository, "closed");
  return [...open, ...closed];
});
export const showIssue = Effect.fn("Issue.show")(function*(identity: IssueIdentity) { return yield* (yield* IssueRemote).get(identity); });
function noChange(issue: RemoteIssue, payload: IssuePayload): boolean {
  switch (payload.operation) {
    case "close": return issue.state === "closed";
    case "reopen": return issue.state === "open";
    case "body-set": return issue.body === payload.body;
    case "labels-add": return payload.labels.every(label => issue.labels.includes(label));
    case "labels-remove": return payload.labels.every(label => !issue.labels.includes(label));
    default: return false;
  }
}
export const prepareIssue = Effect.fn("Issue.prepare")(function*(identity: IssueIdentity | CreateIdentity, operation: IssueOperation, payload: IssuePayload, now: number, binding: IssueBinding) {
  if (payload.operation !== operation || !sameRepository(identity, binding.repository)) return yield* Effect.fail(new IssueInputError({ message: "operation, binding and payload disagree" }));
  if ((payload.operation === "labels-add" || payload.operation === "labels-remove") && (payload.labels.length === 0 || (payload.operation === "labels-remove" && payload.labels.length !== 1))) return yield* Effect.fail(new IssueInputError({ message: "labels-remove requires exactly one label; labels-add requires labels" }));
  const remote = yield* IssueRemote;
  yield* remote.verifyRepository(binding.repository, binding.repositoryId);
  let preimage: string;
  if ("number" in identity) {
    if (operation === "create") return yield* Effect.fail(new IssueInputError({ message: "create requires create identity" }));
    const issue = yield* remote.get(identity);
    if (issue.isPullRequest) return yield* Effect.fail(new IssueTargetIsPullRequest({ message: "Target is a Pull Request" }));
    if (noChange(issue, payload)) return yield* Effect.fail(new IssueNoChange({ message: "Issue already has the planned state" }));
    preimage = remoteIssueDigest(issue);
  } else {
    if (payload.operation !== "create") return yield* Effect.fail(new IssueInputError({ message: "create identity requires create payload" }));
    const issues = yield* listIssues(identity);
    if (identity.kind === "machine-origin") {
      const declaredDigest = /^payload-sha256:\s*([0-9a-f]{64})\s*$/mu.exec(payload.body)?.[1];
      if (!identity.originKey || declaredDigest === undefined || !originMatches({ body: payload.body } as RemoteIssue, identity.originKey)) return yield* Effect.fail(new IssueInputError({ message: "machine-origin body requires matching origin-key and payload-sha256 markers" }));
      yield* requireUnseenMachineOrigin(issues, identity.originKey, declaredDigest);
    }
    preimage = remoteCreateDigest(issues, identity, payload);
  }
  const receipt = planIssueMutation(identity, operation, payload, preimage, now, binding);
  yield* (yield* IssuePlanStore).plan(receipt);
  return receipt;
});
export const executeIssuePlan = Effect.fn("Issue.executePlan")(function*(receipt: IssuePlanReceipt, now: number, binding: IssueBinding, authorize: string) {
  const valid = yield* Effect.try({ try: () => Schema.decodeUnknownSync(IssuePlanReceiptSchema, { onExcessProperty: "error" })(receipt), catch: () => new IssuePlanCorrupt({ receiptId: receipt.id, message: "invalid issue plan receipt" }) });
  if (valid.payloadDigest !== digest(valid.payload) || valid.operation !== valid.payload.operation || !sameRepository(valid.repository, valid.identity) || (valid.operation === "create") === ("number" in valid.identity)) return yield* Effect.fail(new IssuePlanCorrupt({ receiptId: receipt.id, message: "receipt payload or identity is inconsistent" }));
  if (binding.connection !== receipt.connection || binding.repositoryId !== receipt.repositoryId || !sameRepository(binding.repository, receipt.repository) || authorize !== issueAuthorization(receipt)) return yield* Effect.fail(new IssueAuthorizationMismatch({ message: "Connection or authorization target differs from the plan" }));
  const store = yield* IssuePlanStore;
  yield* store.consume(receipt, now);
  const remote = yield* IssueRemote;
  const mutation = Effect.gen(function*() {
    yield* remote.verifyRepository(receipt.repository, receipt.repositoryId);
    const current = "number" in receipt.identity ? remoteIssueDigest(yield* remote.get(receipt.identity)) : remoteCreateDigest(yield* listIssues(receipt.identity), receipt.identity, receipt.payload as Extract<IssuePayload, { operation: "create" }>);
    if (current !== receipt.remotePreimageDigest) return yield* Effect.fail(new IssuePlanDrifted({ receiptId: receipt.id, expected: receipt.remotePreimageDigest, actual: current }));
    return yield* remote.mutate(receipt);
  });
  const result = yield* mutation.pipe(Effect.catch(error => Effect.gen(function*() {
    const code = "code" in error ? error.code : error._tag;
    const status = code === "IssuePlanDrifted" ? "drifted" : code === "IssueMutationUncertain" ? "uncertain" : code === "IssueRemoteRejected" ? "rejected" : "aborted";
    const rejection = "details" in error && error.details !== undefined && "status" in error.details ? error.details.status : undefined;
    yield* store.outcome(receipt, { state: status, receiptId: receipt.id, issueOperation: receipt.operation, target: issueTarget(receipt), ...(status === "aborted" ? { code } : {}), ...(status === "rejected" && typeof rejection === "number" ? { status: rejection } : {}) }).pipe(Effect.catch(() => Effect.void));
    return yield* Effect.fail(error);
  })));
  yield* store.outcome(receipt, { state: "applied", receiptId: receipt.id, issueOperation: receipt.operation, target: issueTarget(receipt) });
  return result;
});
export const prepareCreate = (identity: CreateIdentity, title: string, body: string, now: number, binding: IssueBinding) => prepareIssue(identity, "create", { operation: "create", title, body }, now, binding);
export const prepareBodySet = (identity: IssueIdentity, body: string, now: number, binding: IssueBinding) => prepareIssue(identity, "body-set", { operation: "body-set", body }, now, binding);
export const prepareLabelsAdd = (identity: IssueIdentity, labels: readonly string[], now: number, binding: IssueBinding) => prepareIssue(identity, "labels-add", { operation: "labels-add", labels }, now, binding);
export const prepareLabelsRemove = (identity: IssueIdentity, labels: readonly string[], now: number, binding: IssueBinding) => prepareIssue(identity, "labels-remove", { operation: "labels-remove", labels }, now, binding);
export const prepareCommentAdd = (identity: IssueIdentity, body: string, now: number, binding: IssueBinding) => prepareIssue(identity, "comment-add", { operation: "comment-add", body }, now, binding);
export const prepareClose = (identity: IssueIdentity, reason: "completed" | "not_planned" | undefined, now: number, binding: IssueBinding) => prepareIssue(identity, "close", { operation: "close", ...(reason === undefined ? {} : { reason }) }, now, binding);
export const prepareReopen = (identity: IssueIdentity, now: number, binding: IssueBinding) => prepareIssue(identity, "reopen", { operation: "reopen" }, now, binding);
export const requireUnseenMachineOrigin = (issues: readonly RemoteIssue[], originKey: string, payloadDigest: string): Effect.Effect<void, IssueCreateConflict> => {
  const matches = issues.filter(issue => !issue.isPullRequest && originMatches(issue, originKey));
  if (matches.length === 0) return Effect.void;
  if (matches.length > 1) return Effect.fail(new IssueCreateConflict({ message: `multiple Issues have origin-key ${originKey}` }));
  const marker = /^payload-sha256:\s*([0-9a-f]{64})\s*$/mu.exec(matches[0]!.body)?.[1];
  return Effect.fail(new IssueCreateConflict({ message: marker === payloadDigest ? "machine origin already exists" : "machine origin exists with a different payload" }));
};
