import { Result } from "effect";
import type { IssueClosure, IssueMemoryRelation, IssueMeta } from "concord-sdlc/model";
import { FeedbackReferenceConflict } from "./errors.js";

const conflict = (operation: string, message: string): Result.Result<never, FeedbackReferenceConflict> =>
  Result.fail(new FeedbackReferenceConflict({ operation, message }));

export function linkMemory(issue: IssueMeta, relation: IssueMemoryRelation): Result.Result<IssueMeta, FeedbackReferenceConflict> {
  if (issue.memoryRelations.some((item) => item.kind === relation.kind && item.memory === relation.memory)) return conflict("link", "memory relation already exists");
  return Result.succeed({ ...issue, memoryRelations: [...issue.memoryRelations, relation] });
}
export function adoptFeedback(issue: IssueMeta, target: string): Result.Result<IssueMeta, FeedbackReferenceConflict> {
  if (issue.state === "closed") return conflict("adopt", "closed Issue must be reopened before adoption");
  if (issue.adoptions.current.includes(target)) return conflict("adopt", "target is already adopted");
  return Result.succeed({ ...issue, adoptions: { ...issue.adoptions, current: [...issue.adoptions.current, target] } });
}
export function retireFeedback(issue: IssueMeta, target: string, commit: string): Result.Result<IssueMeta, FeedbackReferenceConflict> {
  if (!issue.adoptions.current.includes(target)) return conflict("retire", "target is not currently adopted");
  return Result.succeed({ ...issue, adoptions: { current: issue.adoptions.current.filter((item) => item !== target), history: [...issue.adoptions.history, { target, commit }] } });
}
export function closeFeedback(issue: IssueMeta, closure: IssueClosure, at: string, reason: string): Result.Result<IssueMeta, FeedbackReferenceConflict> {
  if (issue.state === "closed") return conflict("close", "Issue is already closed");
  if (closure.kind === "duplicate" && closure.canonical === `docs/issues/${issue.id}.md`) return conflict("close", "Issue cannot duplicate itself");
  if ((closure.kind === "declined" || closure.kind === "invalid" || closure.kind === "duplicate") && issue.adoptions.current.length > 0) return conflict("close", "retire current adoptions before this closure");
  if (closure.kind === "delivered" && !issue.adoptions.current.includes(closure.target) && !issue.adoptions.history.some((item) => item.target === closure.target)) return conflict("close", "delivered target is absent from adoption history");
  return Result.succeed({ ...issue, state: "closed", closure, history: [...issue.history, { action: "close", at, reason }] });
}
export function reopenFeedback(issue: IssueMeta, at: string, reason: string): Result.Result<IssueMeta, FeedbackReferenceConflict> {
  if (issue.state !== "closed") return conflict("reopen", "Issue is not closed");
  const { closure: _closure, ...open } = issue;
  return Result.succeed({ ...open, state: "draft", history: [...issue.history, { action: "reopen", at, reason }] });
}
