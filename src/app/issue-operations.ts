import { Clock, Effect, Schema } from "effect";
import { IssueProject, IssuePlanStore, prepareIssue, issueAuthorization, issueTarget, executeIssuePlan } from "../domain/issues/index.js";
import { IssueInputError, IssuePayloadSchema, type IssuePayload, type IssueIdentity, type CreateIdentity } from "../model/index.js";
import type { IssueCommandRequirements as Requirements, IssueCommandRunner as Runner } from "../domain/issues/index.js";
export type IssueCommandRequirements = Requirements;
export type IssueCommandRunner<R = never> = Runner<R>;

export const planRemoteIssue = (id: string, number: number | undefined, payload: IssuePayload, originKey?: string) => Effect.gen(function*() {
    const project = yield* IssueProject;
    const binding = yield* project.connection(id);
    const validated = yield* Effect.try({ try: () => Schema.decodeUnknownSync(IssuePayloadSchema, { onExcessProperty: "error" })(payload), catch: () => new IssueInputError({ message: "Invalid Issue payload or label (maximum 50 characters, no control characters)" }) });
    const identity: IssueIdentity | CreateIdentity = number === undefined ? { ...binding.repository, kind: originKey === undefined ? "manual" : "machine-origin", ...(originKey === undefined ? {} : { originKey }) } : { ...binding.repository, number };
    const receipt = yield* prepareIssue(identity, payload.operation, validated, yield* Clock.currentTimeMillis, binding);
    return { operation: "issue-plan", receiptId: receipt.id, connection: receipt.connection, issueOperation: receipt.operation, target: issueTarget(receipt), payloadDigest: receipt.payloadDigest, remotePreimageDigest: receipt.remotePreimageDigest, expiresAt: new Date(receipt.expiresAt).toISOString(), authorize: issueAuthorization(receipt) };
  });

export const readRemoteIssueBody = Effect.fn('issue.readBody')(function*(path: string) {
  return yield* (yield* IssueProject).readBody(path);
});
export const executeRemoteIssue = Effect.fn('issue.executeRemote')(function*(connection: string, receiptId: string, authorize: string) {
  const receipt = yield* (yield* IssuePlanStore).read(receiptId);
  const binding = yield* (yield* IssueProject).connection(connection);
  const result = yield* executeIssuePlan(receipt, yield* Clock.currentTimeMillis, binding, authorize);
  const { number, url, state, title, labels } = result.issue;
  return { operation: 'issue-execute', receiptId: receipt.id, issueOperation: receipt.operation, issue: { number, url, state, title, labels } };
});
