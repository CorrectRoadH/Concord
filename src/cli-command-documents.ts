// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md#create
// @concord-implements docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md#edit-page
import { formatUseCase, renameUseCaseStep, useCaseSteps } from './step-commands.js';
import { Option } from 'effect';
import { Argument, Command, Flag } from 'effect/unstable/cli';
import { addPage, showPage, setPage, adoptRoadmap, correctDesignReason, createDocument, decideDesign, loadDocuments } from './documents.js';
import { checkDesign, formatDesign } from './documents.js';
import { documentShow } from './trace.js';
import { ConcordError, type DocumentKind } from './shared.js';
import { text, optional, many, id, body, sync, cached, expected } from './cli-base.js';
import { withRepo, withReadRepo } from './cli-repository.js';

function docsGroup(kind: Exclude<DocumentKind, 'memory' | 'issue'>) {
  const create = Command.make('create', { id, title: text('title'), body: optional('body'), feature: optional('feature'), observedAt: optional('observed-at'), source: many('source'), alternative: many('alternative'), pages: many('pages'), noPages: Flag.boolean('no-pages').pipe(Flag.withDefault(false)) }, args => withRepo((repo, s) => sync(() => {
    if (args.noPages && args.pages.length) throw new ConcordError('ConflictingOptions', '--no-pages cannot be combined with --pages');
    return createDocument(repo, kind, { id: args.id, title: args.title, body: Option.isSome(args.body) ? body(args.body.value) : undefined, feature: Option.getOrUndefined(args.feature), observedAt: Option.getOrUndefined(args.observedAt), sources: args.source, alternatives: args.alternative, pages: args.noPages ? [] : args.pages.length ? args.pages.flatMap(value => value.split(',').map(page => page.trim())) : undefined, dryRun: s.dryRun });
  }))).pipe(Command.withDescription('Create a writing scaffold. Feature/Roadmap/Design omitted pages use project defaults; --no-pages explicitly creates README only. Link applicable constitution clauses from the body.'));
  const list = Command.make('list', {}, () => withReadRepo(repo => sync(() => ({ operation: `${kind}-list`, documents: loadDocuments(repo).filter(d => d.metadata.kind === kind).map(d => ({ path: d.path, ...d.metadata })) }))));
  const show = Command.make('show', { id }, ({ id }) => withReadRepo((repo, settings) => sync(() => documentShow(repo, id, kind, cached(settings.dryRun)))));
  const adopt = Command.make('adopt', { id, feature: text('feature') }, args => withRepo((repo, s) => sync(() => adoptRoadmap(repo, args.id, args.feature, s.dryRun))));
  const decide = Command.make('decide', { id, selected: text('selected'), target: many('target'), reason: text('reason') }, args => withRepo((repo, s) => sync(() => decideDesign(repo, args.id, args.selected, args.target, args.reason, s.dryRun))));
  const correctReason = Command.make('correct-reason', { id, reason: text('reason'), memory: text('memory'), explanation: text('explanation'), expectedDigest: text('expected-digest'), expectedMemoryDigest: text('expected-memory-digest') }, args => withRepo((repo, s) => sync(() => correctDesignReason(repo, args.id, args.reason, args.memory, args.explanation, args.expectedDigest, args.expectedMemoryDigest, s.dryRun))));
  const designCheck = Command.make('check', { id }, args => withRepo(repo => sync(() => { const result = checkDesign(repo, args.id); if (!result.ok) process.exitCode = 1; return result; }), { readonly: true }));
  const designFormat = Command.make('format', { id }, args => withRepo((repo, s) => sync(() => formatDesign(repo, args.id, s.dryRun))));
  const pageName = Argument.string('page');
  const page = Command.make('page').pipe(Command.withDescription('Add, inspect, or replace a package page. Use --plan <alternative> for a Design candidate.'), Command.withSubcommands([
    Command.make('add', { id, page: pageName, plan: optional('plan') }, args => withRepo((repo,s) => sync(() => addPage(repo,kind,args.id,args.page,s.dryRun,Option.getOrUndefined(args.plan))))),
    Command.make('show', { id, page: pageName, plan: optional('plan') }, args => withReadRepo(repo => sync(() => showPage(repo,kind,args.id,args.page,Option.getOrUndefined(args.plan))))),
    Command.make('set', { id, page: pageName, body: text('body'), expectedDigest: text('expected-digest'), plan: optional('plan') }, args => withRepo((repo,s) => sync(() => setPage(repo,kind,args.id,args.page,body(args.body),args.expectedDigest,s.dryRun,Option.getOrUndefined(args.plan))))),
  ]));
  const stepCommands = [
    Command.make('steps', { id }, args => withReadRepo(repo => sync(() => useCaseSteps(repo, args.id)))),
    Command.make('format', { id, seed: Flag.boolean('seed').pipe(Flag.withDefault(false)), list: Flag.integer('list').pipe(Flag.optional) }, args => withRepo((repo, s) => sync(() => formatUseCase(repo, args.id, args.seed, Option.getOrUndefined(args.list), s.dryRun)))),
    Command.make('rename-step', { id, oldId: Argument.string('old-id'), newId: Argument.string('new-id') }, args => withRepo((repo, s) => sync(() => renameUseCaseStep(repo, args.id, args.oldId, args.newId, s.dryRun)))),
  ];
  const commands = kind === 'roadmap' ? [create, list, show, page, adopt] : kind === 'design' ? [create, list, show, page, decide, correctReason, designCheck, designFormat] : kind === 'feature' || kind === 'engineering' || kind === 'research' ? [create, list, show, page] : kind === 'use-case' ? [create, list, show, ...stepCommands] : [create, list, show];
  return Command.make(kind).pipe(Command.withDescription(`Maintain ${kind} contracts.`), Command.withSubcommands(commands));
}

export { docsGroup };
