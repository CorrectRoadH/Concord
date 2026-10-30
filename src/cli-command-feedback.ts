// @concord-file
// @concord-implements docs/feature/feedback/use-case/triage-feedback.md
import { Effect, Option } from 'effect';
import { Argument, Command, Flag } from 'effect/unstable/cli';
import { listFeedback, syncFeedback } from './feedback.js';
import { FeedbackConnectionSchema } from './feedback-schema.js';
import { setConfig, showConfig } from './editing.js';
import { documentShow } from './trace.js';
import { ConcordError, decode } from './shared.js';
import { executeViewAction } from './application.js';
import { root, text, optional, id, emit, sync, cached, viewRoot } from './cli-base.js';
import { withRepo, withReadRepo } from './cli-repository.js';
import { feedbackFilters, selectedFeedbackFilters } from './cli-feedback-flags.js';

const retiredFeedback = (name: string, replacement: string) => Command.make(name, {}, () => sync(() => { throw new ConcordError('CommandRetired', `Use ${replacement}`, { command: `concord feedback ${name}`, replacement }); })).pipe(Command.withDescription(`Use ${replacement} to maintain an Issue.`));

const feedbackConnection = Command.make('connection').pipe(Command.withDescription('Configure feedback providers; GitHub CLI mode reuses the server machine login.'), Command.withSubcommands([
  Command.make('list', {}, () => withReadRepo(repo => sync(() => ({ operation: 'feedback-connection-list', connections: repo.config.feedbackConnections ?? [] })))),
  Command.make('add', {
    id: text('id'),
    provider: Flag.choice('provider', ['github', 'linear']),
    transport: Flag.choice('transport', ['api', 'gh']).pipe(Flag.optional),
    credentialEnv: optional('credential-env'),
    owner: optional('owner'),
    repo: optional('repo'),
    team: optional('team'),
  }, args => withRepo((local, settings) => sync(() => {
    const owner = Option.getOrUndefined(args.owner), repo = Option.getOrUndefined(args.repo), team = Option.getOrUndefined(args.team);
    const transport = Option.getOrUndefined(args.transport) ?? 'api';
    const credentialEnv = Option.getOrUndefined(args.credentialEnv);
    if (args.provider === 'github' && (owner === undefined || repo === undefined || team !== undefined)) throw new ConcordError('InvalidOption', 'GitHub connections require --owner and --repo and do not accept --team');
    if (args.provider === 'linear' && (team === undefined || owner !== undefined || repo !== undefined)) throw new ConcordError('InvalidOption', 'Linear connections require --team and do not accept --owner or --repo');
    if (args.provider === 'linear' && transport !== 'api') throw new ConcordError('InvalidOption', 'Linear does not support CLI transport');
    if (transport === 'gh' && credentialEnv !== undefined) throw new ConcordError('InvalidOption', 'GitHub CLI connections reject --credential-env');
    if (transport === 'api' && credentialEnv === undefined) throw new ConcordError('InvalidOption', 'API connections require --credential-env');
    const connection = decode(FeedbackConnectionSchema, args.provider === 'github'
      ? transport === 'gh' ? { id: args.id, provider: args.provider, transport: 'gh', owner, repo } : { id: args.id, provider: args.provider, credentialEnv, owner, repo }
      : { id: args.id, provider: args.provider, credentialEnv, team }, 'feedback connection');
    const current = showConfig(local);
    if ((current.config.feedbackConnections ?? []).some(item => item.id === connection.id)) throw new ConcordError('FeedbackConnectionExists', `Feedback connection ${connection.id} already exists`);
    return setConfig(local, { ...current.config, feedbackConnections: [...(current.config.feedbackConnections ?? []), connection] }, current.digest, settings.dryRun);
  }))),
  Command.make('check', { id }, args => Effect.gen(function* () {
    const settings = yield* root;
    if (settings.dryRun) return yield* Effect.fail(new ConcordError('InvalidOption', 'feedback connection check does not accept --dry-run'));
    const result = yield* executeViewAction(viewRoot(settings), { action: 'feedback.check', connection: args.id });
    yield* Effect.sync(() => emit(result, settings.json));
  })),
  Command.make('remove', { id }, args => withRepo((local, settings) => sync(() => {
    const current = showConfig(local);
    const connections = current.config.feedbackConnections ?? [];
    if (!connections.some(connection => connection.id === args.id)) throw new ConcordError('FeedbackConnectionNotFound', `No feedback connection has ID ${args.id}`);
    return setConfig(local, { ...current.config, feedbackConnections: connections.filter(connection => connection.id !== args.id) }, current.digest, settings.dryRun);
  }))),
]));

const feedbackSync = Command.make('sync', { connection: text('connection') }, args => Effect.gen(function*() {
  const settings = yield* root;
  const receipt = yield* syncFeedback(viewRoot(settings), args.connection, { dryRun: settings.dryRun });
  yield* Effect.sync(() => emit(receipt, settings.json));
}));

const feedbackImport = Command.make('import', { url: Argument.string('url'), connection: text('connection') }, args => Effect.gen(function*() {
  const settings = yield* root;
  const receipt = yield* syncFeedback(viewRoot(settings), args.connection, { url: args.url, dryRun: settings.dryRun });
  yield* Effect.sync(() => emit(receipt, settings.json));
}));

const feedback = Command.make('feedback').pipe(Command.withDescription('Connect external feedback sources and import observations as local Issues.'), Command.withSubcommands([
  Command.make('list', feedbackFilters, args => withReadRepo(repo => sync(() => ({ operation: 'feedback-list', feedback: listFeedback(repo, undefined, selectedFeedbackFilters(args)) })))),
  Command.make('show', { id }, args => withReadRepo((repo, settings) => sync(() => {
    const item = listFeedback(repo).find(candidate => candidate.document.metadata.id === args.id);
    if (!item) throw new ConcordError('DocumentNotFound', `No feedback matches ${args.id}`);
    const relations = documentShow(repo, item.document.path, 'issue', cached(settings.dryRun));
    return { operation: 'feedback-show', feedback: { ...item, document: relations.document }, incoming: relations.incoming, outgoing: relations.outgoing, complete: relations.complete, findings: relations.findings };
  }))),
  feedbackSync,
  feedbackImport,
  feedbackConnection,
]));

export { feedback };
