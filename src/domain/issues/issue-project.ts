import type { Effect } from "effect";
import { Context } from "effect";
import type { IssuePlanStore, IssueRemote } from "./repo-issue-domain.ts";
import { type IssueError } from "../../model/index.ts";
import type { IssueBinding , ConcordError} from "../../model/index.ts";
export class IssueProject extends Context.Service<IssueProject, {
  readonly connection: (id: string) => Effect.Effect<IssueBinding, IssueError>;
  readonly readBody: (path: string) => Effect.Effect<string, IssueError>;
}>()("concord/issue/Project") {}
export type IssueCommandRequirements = IssueRemote | IssuePlanStore | IssueProject;
export type IssueCommandRunner<R = never> = <A>(connection: string, execute: boolean, program: Effect.Effect<A, IssueError, IssueCommandRequirements>) => Effect.Effect<A, IssueError | ConcordError, R>;
