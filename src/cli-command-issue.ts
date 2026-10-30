// @concord-file
// @concord-implements docs/feature/neutral-project-governance/use-case/mutate-remote-issue.md
// @concord-implements docs/feature/feedback/use-case/manage-local-observations.md
import { feedbackFilters, selectedFeedbackFilters } from './cli-feedback-flags.js';
import { Effect, Option } from 'effect';
import { Argument, Command, Flag } from 'effect/unstable/cli';
import { adoptIssue, retireIssue, reopenIssue, closeIssue, createDocument, linkIssue, unlinkIssue } from './documents.js';
import { closeFixedIssue } from './fix-verification.js';
import { listFeedback } from './feedback.js';
import { editKnowledge, knowledgeIndex, knowledgeRecall, removeIssue } from './knowledge.js';
import { documentShow } from './trace.js';
import { ConcordError, IssueClosureSchema, MEMORY_RELATION_KINDS, decode } from './shared.js';
import { root, text, optional, many, id, body, sync, cached, expected } from './cli-base.js';
import { withRepo, withReadRepo } from './cli-repository.js';

const closureFlags = { kind: Flag.choice('kind', ['fixed', 'delivered', 'duplicate', 'declined', 'invalid', 'external-fixed', 'closed']).pipe(Flag.withDefault('closed')), memory: optional('memory'), target: optional('target'), proof: many('proof'), canonical: optional('canonical'), evidence: many('evidence'), dependency: optional('dependency'), version: optional('version'), reason: optional('reason') };

const issueContributionPath = new URL(import.meta.url).pathname.endsWith('.ts') ? '../repository/issue/contribution.ts' : './repository/issue/contribution.js';

const issueNodePath = new URL(import.meta.url).pathname.endsWith('.ts') ? '../repository/issue/node.ts' : './repository/issue/node.js';

const issueRemoteContribution = await import(issueContributionPath) as { makeIssueRemoteSubcommands: (deliver: (delivery: { stdout: string; stderr: string; exitCode: number }) => Effect.Effect<void>, run: <A>(connection: string, execute: boolean, program: Effect.Effect<A, unknown, unknown>) => Effect.Effect<A, ConcordError, Command.CommandContext<"concord">>, sharedJson?: boolean) => readonly Command.Command<any, never, unknown, never, Command.CommandContext<"concord">>[] };

const issueRemoteNode = await import(issueNodePath) as { makeNodeIssueCommandRunner: (root?: string) => <A>(connection: string, execute: boolean, program: Effect.Effect<A, unknown, unknown>) => Effect.Effect<A, ConcordError> };

const issueRemoteCommands = issueRemoteContribution.makeIssueRemoteSubcommands(
  (delivery: { stdout: string; stderr: string; exitCode: number }) => Effect.sync(() => {
    process.stdout.write(delivery.stdout); process.stderr.write(delivery.stderr); if (delivery.exitCode !== 0) process.exitCode = delivery.exitCode;
  }),
  <A>(connection: string, execute: boolean, program: Effect.Effect<A, unknown, unknown>) => Effect.gen(function*() {
    const settings = yield* root;
    if (settings.dryRun) return yield* Effect.fail(new ConcordError('InvalidInput', 'Issue plan/execute does not accept --dry-run'));
    return yield* issueRemoteNode.makeNodeIssueCommandRunner(Option.getOrUndefined(settings.root))(connection, execute, program);
  }),
  true,
);

const issue = Command.make('issue').pipe(Command.withDescription('Maintain local Issue owners; remote GitHub writes only through plan and execute.'), Command.withSubcommands([
  ...issueRemoteCommands,
  Command.make('recall', { query: Argument.string('query') }, args => withRepo(repo => sync(() => knowledgeRecall(repo, 'issue', args.query)), { readonly: true })).pipe(Command.withDescription('Recall local Issues.')),
  Command.make('link', { id, target: Argument.string('target'), role: Flag.choice('role', [...MEMORY_RELATION_KINDS, 'adopts']).pipe(Flag.withDefault('investigation')) }, args => withRepo((repo,s) => sync(() => linkIssue(repo,args.id,args.target,s.dryRun,args.role)))).pipe(Command.withDescription('Relate an Issue to Memory or Spec.')),
  Command.make('unlink', { id, target: Argument.string('target'), role: Flag.choice('role', [...MEMORY_RELATION_KINDS, 'adopts']).pipe(Flag.withDefault('investigation')) }, args => withRepo((repo,s) => sync(() => unlinkIssue(repo,args.id,args.target,s.dryRun,args.role)))),
  Command.make('reopen', { id, reason: text('reason') }, args => withRepo((repo,s) => sync(() => reopenIssue(repo,args.id,args.reason,s.dryRun)))).pipe(Command.withDescription('Reopen a closed Issue with a reason.')),
  Command.make('close', { id, ...closureFlags, fixed: Flag.boolean('fixed').pipe(Flag.withDefault(false)), defect: optional('defect') }, args => withRepo((repo,s) => Effect.gen(function* () {
    if (args.fixed || args.kind === 'fixed') { if (s.dryRun) return yield* Effect.fail(new ConcordError('InvalidOption','fixed verification does not accept --dry-run')); return yield* closeFixedIssue(repo,args.id,Option.getOrUndefined(args.reason) ?? 'Verified fix',Option.getOrUndefined(args.defect)); }
    if (Option.isSome(args.defect)) return yield* Effect.fail(new ConcordError('InvalidOption','--defect requires --fixed'));
    return yield* sync(() => {
    const closure = { kind: args.kind, ...Object.fromEntries(['memory','target','canonical','dependency','version','reason'].flatMap(key => { const value = Option.getOrUndefined(args[key as 'memory']); return value === undefined ? [] : [[key,value]]; })), ...(args.proof.length ? { proof: args.proof } : {}), ...(args.evidence.length ? { evidence: args.evidence } : {}) };
    return closeIssue(repo,args.id,decode(IssueClosureSchema,closure,'Issue closure'),s.dryRun);
  });
  }), { unlocked: true })).pipe(Command.withDescription('Close an Issue with a validated conclusion.')),
]));

export { issue };
