import { Context, Effect } from "effect";
import { IssuePlanStore, IssueRemote } from "./repo-issue-domain.js";
import { ConcordError, type IssueError } from "../../model/index.js";
import { type IssueBinding } from "../../model/index.js";
export class IssueProject extends Context.Service<IssueProject, {
  readonly connection: (id: string) => Effect.Effect<IssueBinding, IssueError>;
  readonly readBody: (path: string) => Effect.Effect<string, IssueError>;
}>()("concord/issue/Project") {}
export type IssueCommandRequirements = IssueRemote | IssuePlanStore | IssueProject;
export type IssueCommandRunner<R = never> = <A>(connection: string, execute: boolean, program: Effect.Effect<A, IssueError, IssueCommandRequirements>) => Effect.Effect<A, IssueError | ConcordError, R>;
