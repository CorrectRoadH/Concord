// @concord-file
// @concord-implements docs/feature/neutral-project-governance/use-case/mutate-remote-issue.md
// @concord-implements docs/feature/feedback/use-case/manage-local-observations.md

import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { closeIssue, linkIssue, unlinkIssue } from "../../domain/issues/index.ts";

import { ConcordError, MEMORY_RELATION_KINDS, decode } from "../../model/index.ts";
import { root, text, optional, many, id, sync } from "./cli-base.ts";
import { withRepo, withQuery } from "./cli-repository.ts";

import type { IssueError } from "../../model/index.ts";
import type { IssueCommandRequirements } from "../../app/index.ts";
import * as issueRemoteContribution from './repo-issue-contribution.ts';
import { makeNodeIssueCommandRunner } from "../../app/index.ts";
import { setExitCode, writeStderr, writeStdout } from './invocation.ts';

const issueRemoteCommands = issueRemoteContribution.makeIssueRemoteSubcommands(
  (delivery: { stdout: string; stderr: string; exitCode: number }) => Effect.gen(function*() {
    yield* writeStdout(delivery.stdout);
    yield* writeStderr(delivery.stderr);
    if (delivery.exitCode !== 0) yield* setExitCode(delivery.exitCode);
  }),
  <A>(connection: string, execute: boolean, program: Effect.Effect<A, IssueError, IssueCommandRequirements>) => Effect.gen(function*() {
    const settings = yield* root;
    if (settings.dryRun) return yield* Effect.fail(new ConcordError('InvalidInput', 'Issue remote preview/apply does not accept --dry-run'));
    return yield* makeNodeIssueCommandRunner(Option.getOrUndefined(settings.root))(connection, execute, program);
  }),
  true,
);

const issue = Command.make('issue').pipe(Command.withDescription('Maintain local Issue owners; remote GitHub writes through remote preview and apply.'), Command.withSubcommands([
  Command.make('remote').pipe(Command.withSubcommands(issueRemoteCommands)),
  Command.make('search', { query: Argument.String('query') }, args => withQuery({ name: 'issue.search', input: { query: args.query } })).pipe(Command.withDescription('Recall local Issues.')),
  Command.make('link', { id, target: Argument.String('target'), role: Flag.Literals('role', [...MEMORY_RELATION_KINDS, 'spec']).pipe(Flag.withDefault('investigation')) }, args => withRepo((repo,s) => sync(async () => (await linkIssue(repo,args.id,args.target,s.dryRun,args.role))))).pipe(Command.withDescription('Relate an Issue to Memory or Spec.')),
  Command.make('unlink', { id, target: Argument.String('target'), role: Flag.Literals('role', [...MEMORY_RELATION_KINDS, 'spec']).pipe(Flag.withDefault('investigation')) }, args => withRepo((repo,s) => sync(async () => (await unlinkIssue(repo,args.id,args.target,s.dryRun,args.role))))),
  Command.make('close', { id, reason: optional('reason') }, args => withRepo((repo,s) => sync(() => closeIssue(repo,args.id,Option.getOrUndefined(args.reason),s.dryRun)), { unlocked: true })).pipe(Command.withDescription('Delete a handled Issue and its markers atomically, preserving test definitions.')),
]));

export { issue };
