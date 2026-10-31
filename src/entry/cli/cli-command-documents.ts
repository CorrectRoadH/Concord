// @concord-file
// @concord-implements docs/feature/local-sdlc/cli.md#创建与编辑文档
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { loadDocuments, readDocumentReference, findDocument } from "../../app/index.js";
import { adoptRoadmap } from "../../app/index.js";
import { createDocument } from "../../app/index.js";
import { checkDesign, decideDesign, deferDesign, formatDesign } from "../../app/index.js";
import { documentShow } from "../../app/index.js";
import { formatUseCase, renameUseCaseStep, useCaseSteps } from "../../app/index.js";
import { ConcordError, type DocumentKind } from "../../model/index.js";
import { text, optional, many, id, body, sync, cached } from "./cli-base.js";
import { withRepo, withReadRepo, withQuery } from "./cli-repository.js";

const kinds = ['feature', 'use-case', 'design', 'roadmap', 'engineering', 'issue', 'memory'] as const;
const category = Argument.choice('category', kinds);

export const newDocument = Command.make('new', {
  category, name: Argument.string('name'), title: optional('title'), body: optional('body'),
  type: Flag.choice('type', ['decision', 'insight', 'note']).pipe(Flag.optional),
  feature: optional('feature'), pages: many('pages'), alternative: many('alternative'), observedAt: optional('observed-at'), source: many('source'),
}, args => withRepo((repo, settings) => Effect.gen(function*() {
  if (args.category === 'memory' && Option.isNone(args.type)) return yield* Effect.fail(new ConcordError('InvalidInput', 'Memory creation requires --type'));
  const receipt = yield* createDocument(repo, args.category, {
    id: args.name, title: Option.getOrUndefined(args.title) ?? args.name,
    body: Option.isSome(args.body) ? body(args.body.value) : undefined,
    memoryKind: Option.getOrUndefined(args.type), feature: Option.getOrUndefined(args.feature),
    pages: args.pages.length ? args.pages.flatMap(value => value.split(',').map(page => page.trim())) : undefined,
    alternatives: args.category === 'design' && args.alternative.length === 0 ? ['plan-1', 'plan-2'] : args.alternative, observedAt: Option.getOrUndefined(args.observedAt), sources: args.source, dryRun: settings.dryRun,
  });
  return { ...receipt, operation: 'new' };
}))).pipe(Command.withDescription('Create a document from its bundled template; --pages selects optional pages, --type selects Memory type.'));

export const showDocument = Command.make('show', { id }, args => withQuery({ name: 'documents.show', input: { id: args.id } })).pipe(Command.withDescription('Show a document and its relationships by path or selector.'));

export const listDocuments = Command.make('list', { category: category.pipe(Argument.optional) }, args => withQuery({ name: 'documents.list', input: { kind: Option.getOrUndefined(args.category) } })).pipe(Command.withDescription('List documents, optionally within one category.'));

export function docsGroup(kind: Extract<DocumentKind, 'use-case' | 'design' | 'roadmap'>) {
  const commands = kind === 'roadmap' ? [
    Command.make('start', { id, feature: optional('feature') }, args => withRepo((repo, s) => sync(() => adoptRoadmap(repo, args.id, Option.getOrUndefined(args.feature), s.dryRun)))).pipe(Command.withDescription('Start a Roadmap as a Feature; --feature optionally selects a different Feature ID.')),
  ] : kind === 'design' ? [
    Command.make('decide', { id, selected: text('selected'), target: many('target'), reason: text('reason') }, args => withRepo((repo, s) => sync(() => decideDesign(repo, args.id, args.selected, args.target, args.reason, s.dryRun)))),
    Command.make('defer', { id, reason: text('reason') }, args => withRepo((repo, s) => sync(() => deferDesign(repo, args.id, args.reason, s.dryRun)))),
    Command.make('check', { id }, args => withReadRepo(repo => sync(() => { const result = checkDesign(repo, args.id); if (!result.ok) process.exitCode = 1; return result; }))),
    Command.make('format', { id }, args => withRepo((repo, s) => sync(() => formatDesign(repo, args.id, s.dryRun)))),
  ] : [
    Command.make('steps', { id }, args => withReadRepo(repo => sync(() => useCaseSteps(repo, args.id)))),
    Command.make('format', { id, seed: Flag.boolean('seed').pipe(Flag.withDefault(false)), list: Flag.integer('list').pipe(Flag.optional) }, args => withRepo((repo, s) => sync(() => formatUseCase(repo, args.id, args.seed, Option.getOrUndefined(args.list), s.dryRun)))),
    Command.make('rename-step', { id, oldId: Argument.string('old-id'), newId: Argument.string('new-id') }, args => withRepo((repo, s) => sync(() => renameUseCaseStep(repo, args.id, args.oldId, args.newId, s.dryRun)))),
  ];
  return Command.make(kind).pipe(Command.withDescription(`Maintain ${kind} documents.`), Command.withSubcommands(commands));
}
