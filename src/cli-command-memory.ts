// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md#add
// @concord-implements docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md#index
// @concord-implements docs/feature/local-sdlc/use-case/review-traceability.md#show
// @concord-implements docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md#recall
// @concord-implements docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#resolve-fixed
// @concord-implements docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md#lifecycle
import { Option } from 'effect';
import { Argument, Command, Flag } from 'effect/unstable/cli';
import { activateMemory, createDocument, findDocument, loadDocuments, promoteMemory, reopenMemory, resolveMemory, retirePromotion, supersedeMemory } from './documents.js';
import { editKnowledge, knowledgeIndex, knowledgeRecall, knowledgeSearch } from './knowledge.js';
import { verifyFixedEvidence } from './evidence.js';
import { buildTrace, documentShow, requireValidTrace } from './trace.js';
import { ConcordError } from './shared.js';
import { text, optional, id, body, sync, cached, expected } from './cli-base.js';
import { withRepo, withReadRepo } from './cli-repository.js';

const memoryAdd = Command.make('add', { id, title: text('title'), kind: Flag.choice('kind', ['problem','decision','insight','note']), body: optional('body'), source: optional('source') }, args => withRepo((repo,s) => sync(() => createDocument(repo, 'memory', { id: args.id, title: args.title, body: Option.isSome(args.body) ? body(args.body.value) : undefined, memoryKind: args.kind, memorySource: Option.getOrUndefined(args.source), dryRun: s.dryRun }))));

const memoryList = Command.make('list', {}, () => withReadRepo(repo => sync(() => ({ operation: 'memory-list', memories: loadDocuments(repo, ['memory']).map(d => ({path:d.path,...d.metadata})) }))));

const memoryShow = Command.make('show', { id }, args => withReadRepo((repo, settings) => sync(() => documentShow(repo, args.id, 'memory', cached(settings.dryRun)))));

const memorySearch = Command.make('search', { query: Argument.string('query') }, args => withReadRepo(repo => sync(() => knowledgeSearch(repo, args.query))));

const memoryResolve = Command.make('resolve', { id, kind: Flag.choice('kind', ['fixed','not-a-bug','wont-fix','external-fixed']), reason: text('reason'), red: optional('red'), green: optional('green') }, args => withRepo((repo,s) => sync(() => {
  const trace = buildTrace(repo, 'off', { includeCode: false }); requireValidTrace(trace);
  const problem = findDocument(trace.documents, args.id, 'memory');
  const red = Option.getOrUndefined(args.red), green = Option.getOrUndefined(args.green);
  if (args.kind === 'fixed' && (!red || !green)) throw new ConcordError('EvidenceRequired', 'fixed requires --red and --green IDs from concord test run');
  if (args.kind !== 'fixed' && (red || green)) throw new ConcordError('InvalidOption', 'Evidence IDs apply only to fixed resolutions');
  const proof = args.kind === 'fixed' ? verifyFixedEvidence(repo, trace.documents, trace.annotations.cases, problem, red!, green!) : undefined;
  return resolveMemory(repo,args.id,args.kind,args.reason,proof,s.dryRun);
})));

const memory = Command.make('memory').pipe(Command.withDescription('Maintain Problem, Decision, and Insight lifecycles.'), Command.withSubcommands([
  memoryAdd, memoryList, memoryShow, memorySearch, memoryResolve,
  Command.make('index', {}, () => withRepo(repo => sync(() => knowledgeIndex(repo, 'memory')), { readonly: true })),
  Command.make('recall', { query: Argument.string('query') }, args => withRepo(repo => sync(() => knowledgeRecall(repo, 'memory', args.query)), { readonly: true })),
  Command.make('edit', { id, body: text('body'), expectedDigest: text('expected-digest') }, args => withRepo((repo,s) => sync(() => editKnowledge(repo, 'memory', args.id, body(args.body), args.expectedDigest, s.dryRun)))),
  Command.make('activate', { id, reason: text('reason') }, args => withRepo((repo,s) => sync(() => activateMemory(repo, args.id, args.reason, s.dryRun)))),
  Command.make('reopen', { id, reason: text('reason') }, args => withRepo((repo,s) => sync(() => reopenMemory(repo,args.id,args.reason,s.dryRun)))),
  Command.make('supersede', { id, replacement: text('replacement'), reason: text('reason') }, args => withRepo((repo,s) => sync(() => supersedeMemory(repo,args.id,args.replacement,args.reason,s.dryRun)))),
  Command.make('promote', { id, target: text('target') }, args => withRepo((repo,s) => sync(() => promoteMemory(repo,args.id,args.target,s.dryRun)))),
  Command.make('retire', { id, target: text('target'), reason: text('reason') }, args => withRepo((repo,s) => sync(() => retirePromotion(repo,args.id,args.target,args.reason,s.dryRun)))),
]));

export { memory };
