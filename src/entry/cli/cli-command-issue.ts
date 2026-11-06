// @concord-file
// @concord-implements docs/feature/neutral-project-governance/use-case/mutate-remote-issue.md
// @concord-implements docs/feature/feedback/use-case/manage-local-observations.md

import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { closeIssue, linkIssue, unlinkIssue } from "../../app/index.ts";
import { closeFixedIssue } from "../../app/index.ts";

import { knowledgeSearchRecords } from "../../app/index.ts";

import { ConcordError, MEMORY_RELATION_KINDS, decode } from "../../model/index.ts";
import { root, text, optional, many, id, sync } from "./cli-base.ts";
import { withRepo, withQuery } from "./cli-repository.ts";

import type { IssueError } from "../../model/index.ts";
import type { IssueCommandRequirements } from "../../app/index.ts";
import * as issueRemoteContribution from './repo-issue-contribution.ts';
import { makeNodeIssueCommandRunner } from "../../app/index.ts";

const issueRemoteCommands = issueRemoteContribution.makeIssueRemoteSubcommands(
  (delivery: { stdout: string; stderr: string; exitCode: number }) => Effect.sync(() => {
    process.stdout.write(delivery.stdout); process.stderr.write(delivery.stderr); if (delivery.exitCode !== 0) process.exitCode = delivery.exitCode;
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
  Command.make('search', { query: Argument.string('query') }, args => withQuery({ name: 'issue.search', input: { query: args.query } })).pipe(Command.withDescription('Recall local Issues.')),
  Command.make('link', { id, target: Argument.string('target'), role: Flag.choice('role', [...MEMORY_RELATION_KINDS, 'spec']).pipe(Flag.withDefault('investigation')) }, args => withRepo((repo,s) => sync(() => linkIssue(repo,args.id,args.target,s.dryRun,args.role)))).pipe(Command.withDescription('Relate an Issue to Memory or Spec.')),
  Command.make('unlink', { id, target: Argument.string('target'), role: Flag.choice('role', [...MEMORY_RELATION_KINDS, 'spec']).pipe(Flag.withDefault('investigation')) }, args => withRepo((repo,s) => sync(() => unlinkIssue(repo,args.id,args.target,s.dryRun,args.role)))),
  Command.make('close', { id, reason: optional('reason'), fixed: Flag.boolean('fixed').pipe(Flag.withDefault(false)), defect: optional('defect'), fix: optional('fix') }, args => withRepo((repo,s) => Effect.gen(function* () {
    if (args.fixed) {
      if (s.dryRun) return yield* Effect.fail(new ConcordError('InvalidOption','fixed verification does not accept --dry-run'));
      return yield* closeFixedIssue(repo,args.id,Option.getOrUndefined(args.reason) ?? 'Verified fix',Option.getOrUndefined(args.defect),Option.getOrUndefined(args.fix));
    }
    if (Option.isSome(args.defect) || Option.isSome(args.fix)) return yield* Effect.fail(new ConcordError('InvalidOption','--defect and --fix require --fixed'));
    return yield* sync(() => closeIssue(repo,args.id,Option.getOrUndefined(args.reason),s.dryRun));
  }), { unlocked: true })).pipe(Command.withDescription('Delete a handled Issue and print its conclusion; --fixed first verifies the regression.')),
]));

export { issue };
