#!/usr/bin/env node
// @concord-file public-command-interface
// @concord-implements docs/feature/local-sdlc/README.md
import { readFileSync } from 'node:fs';
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Effect, Option } from 'effect';
import { Argument, Command, Flag } from 'effect/unstable/cli';
import { cacheStatus, clearCache, scanAnnotations } from './annotations.js';
import { addPage, showPage, setPage, adoptRoadmap, closeIssue, createDocument, decideDesign, findDocument, linkIssue, loadDocuments, promoteMemory, reopenMemory, resolveMemory, retirePromotion, setAuthor, supersedeMemory } from './documents.js';
import { readEvidence, runCase, verifyFixedEvidence } from './evidence.js';
import { OwnedProcessLive } from './owned-process.js';
import { initialize, LocalRepository } from './storage.js';
import { buildTrace, renderReview, requireValidTrace, selectCase, traceShow } from './trace.js';
import { ConcordError, RunnerSchema, decode, failure, type DocumentKind } from './shared.js';
import { listTemplates, templateBody } from './templates.js';
import { humanOutput } from './presentation.js';
import { annotationSnippet, doctor } from './onboarding.js';
import { codeSnippet, listCode, locateCode, showCode } from './code-commands.js';

const root = Command.make('concord').pipe(Command.withDescription('Connect product contracts, code and test declarations, and engineering memory. Agent guidance: concord --skill [topic].'), Command.withSharedFlags({
  root: Flag.string('root').pipe(Flag.optional, Flag.withDescription('Consumer Git worktree root; otherwise discover concord.json from cwd.')),
  json: Flag.boolean('json').pipe(Flag.withDefault(false)),
  dryRun: Flag.boolean('dry-run').pipe(Flag.withDefault(false), Flag.withDescription('Validate a document mutation without writing.')),
}));
const text = (name: string) => Flag.string(name);
const optional = (name: string) => text(name).pipe(Flag.optional);
const many = (name: string) => text(name).pipe(Flag.atLeast(0));
const id = Argument.string('id');
function body(path: string): string {
  const source = path === '-' ? readFileSync(0, 'utf8') : readFileSync(path, 'utf8');
  if (Buffer.byteLength(source) > 4 * 1024 * 1024) throw new ConcordError('InvalidBody', 'Author content exceeds 4 MiB');
  return source;
}
function emit(value: unknown, json: boolean): void {
  const output = json ? JSON.stringify(value) : humanOutput(value);
  process.stdout.write(output.endsWith('\n') ? output : `${output}\n`);
}
function withRepo<A, E, R>(operation: (repo: LocalRepository, settings: { json: boolean; dryRun: boolean }) => Effect.Effect<A, E, R>, options: { initialize?: boolean; recover?: boolean } = {}) {
  return Effect.gen(function*() {
    const settings = yield* root;
    const repo = yield* Effect.acquireRelease(
      Effect.try({ try: () => new LocalRepository(Option.getOrUndefined(settings.root), { ...options, dryRun: settings.dryRun }), catch: failure }),
      repo => Effect.sync(() => repo.close()),
    );
    return yield* operation(repo, settings).pipe(Effect.tap(result => Effect.sync(() => emit(result, settings.json))));
  }).pipe(Effect.scoped);
}
const sync = <A>(fn: () => A) => Effect.try({ try: fn, catch: failure });
const cached = (dry: boolean) => dry ? 'off' as const : 'use' as const;
const init = Command.make('init', { testRoot: many('test-root'), sourceRoot: many('source-root'), docsOnly: Flag.boolean('docs-only').pipe(Flag.withDefault(false)), runnerConfig: optional('runner-config') }, args => withRepo((repo, s) => sync(() => {
  if (args.docsOnly && args.testRoot.length) throw new ConcordError('ConflictingOptions', '--docs-only cannot be combined with --test-root');
  const configFile = Option.getOrUndefined(args.runnerConfig);
  const runner = configFile === undefined ? undefined : decode(RunnerSchema, JSON.parse(body(configFile)), 'runner configuration');
  return initialize(repo, s.dryRun, { testRoots: args.docsOnly ? [] : args.testRoot.length ? args.testRoot : undefined, sourceRoots: args.sourceRoot.length ? args.sourceRoot : undefined, runner });
}), { initialize: true })).pipe(Command.withDescription('Initialize templates guidance and configuration without overwriting files. --docs-only disables test discovery; --test-root and --source-root repeat; --runner-config reads a runner JSON object.'));
const recover = Command.make('recover', {}, () => withRepo(repo => sync(() => repo.recover()), { recover: true })).pipe(Command.withDescription('Recover interrupted document publication; preserve conflicting external edits.'));

function docsGroup(kind: Exclude<DocumentKind, 'memory' | 'issue'>) {
  const create = Command.make('create', { id, title: text('title'), body: optional('body'), feature: optional('feature'), observedAt: optional('observed-at'), source: many('source'), alternative: many('alternative') }, args => withRepo((repo, s) => sync(() => createDocument(repo, kind, { id: args.id, title: args.title, body: Option.isSome(args.body) ? body(args.body.value) : undefined, feature: Option.getOrUndefined(args.feature), observedAt: Option.getOrUndefined(args.observedAt), sources: args.source, alternatives: args.alternative, dryRun: s.dryRun })))).pipe(Command.withDescription('Create a writing scaffold, or supply prose with --body <file|->. Every package includes its complete page structure.'));
  const list = Command.make('list', {}, () => withRepo(repo => sync(() => ({ operation: `${kind}-list`, documents: loadDocuments(repo).filter(d => d.metadata.kind === kind).map(d => ({ path: d.path, ...d.metadata })) }))));
  const show = Command.make('show', { id }, ({ id }) => withRepo(repo => sync(() => ({ operation: `${kind}-show`, document: findDocument(loadDocuments(repo), id, kind) }))));
  const adopt = Command.make('adopt', { id, feature: text('feature') }, args => withRepo((repo, s) => sync(() => adoptRoadmap(repo, args.id, args.feature, s.dryRun))));
  const decide = Command.make('decide', { id, selected: text('selected'), target: many('target'), reason: text('reason') }, args => withRepo((repo, s) => sync(() => decideDesign(repo, args.id, args.selected, args.target, args.reason, s.dryRun))));
  const pageName = Argument.string('page');
  const page = Command.make('page').pipe(Command.withDescription('Add, inspect, or replace a package page. Use --plan <alternative> for a Design candidate.'), Command.withSubcommands([
    Command.make('add', { id, page: pageName, plan: optional('plan') }, args => withRepo((repo,s) => sync(() => addPage(repo,kind,args.id,args.page,s.dryRun,Option.getOrUndefined(args.plan))))),
    Command.make('show', { id, page: pageName, plan: optional('plan') }, args => withRepo(repo => sync(() => showPage(repo,kind,args.id,args.page,Option.getOrUndefined(args.plan))))),
    Command.make('set', { id, page: pageName, body: text('body'), expectedDigest: text('expected-digest'), plan: optional('plan') }, args => withRepo((repo,s) => sync(() => setPage(repo,kind,args.id,args.page,body(args.body),args.expectedDigest,s.dryRun,Option.getOrUndefined(args.plan))))),
  ]));
  const commands = kind === 'roadmap' ? [create, list, show, page, adopt] : kind === 'design' ? [create, list, show, page, decide] : kind === 'feature' || kind === 'engineering' ? [create, list, show, page] : [create, list, show];
  return Command.make(kind).pipe(Command.withDescription(`Maintain ${kind} contracts.`), Command.withSubcommands(commands));
}
const author = Command.make('author').pipe(Command.withDescription('Edit author prose while retaining managed metadata and history.'), Command.withSubcommands([
  Command.make('set', { ref: Argument.string('reference'), body: text('body'), expectedDigest: text('expected-digest') }, args => withRepo((repo,s) => sync(() => setAuthor(repo, args.ref, body(args.body), args.expectedDigest, s.dryRun)))),
]));
const memoryAdd = Command.make('add', { id, title: text('title'), kind: Flag.choice('kind', ['problem','decision','insight']), body: optional('body') }, args => withRepo((repo,s) => sync(() => createDocument(repo, 'memory', { id: args.id, title: args.title, body: Option.isSome(args.body) ? body(args.body.value) : undefined, memoryKind: args.kind, dryRun: s.dryRun }))));
const memoryList = Command.make('list', {}, () => withRepo(repo => sync(() => ({ operation: 'memory-list', memories: loadDocuments(repo).filter(d => d.metadata.kind === 'memory').map(d => ({path:d.path,...d.metadata})) }))));
const memoryShow = Command.make('show', { id }, args => withRepo(repo => sync(() => ({ operation: 'memory-show', document: findDocument(loadDocuments(repo), args.id, 'memory') }))));
const memorySearch = Command.make('search', { query: Argument.string('query') }, args => withRepo(repo => sync(() => ({ operation: 'memory-search', memories: loadDocuments(repo).filter(d => d.metadata.kind === 'memory' && `${d.metadata.title}\n${d.body}`.toLocaleLowerCase().includes(args.query.toLocaleLowerCase())) }))));
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
  Command.make('reopen', { id, reason: text('reason') }, args => withRepo((repo,s) => sync(() => reopenMemory(repo,args.id,args.reason,s.dryRun)))),
  Command.make('supersede', { id, replacement: text('replacement'), reason: text('reason') }, args => withRepo((repo,s) => sync(() => supersedeMemory(repo,args.id,args.replacement,args.reason,s.dryRun)))),
  Command.make('promote', { id, target: text('target') }, args => withRepo((repo,s) => sync(() => promoteMemory(repo,args.id,args.target,s.dryRun)))),
  Command.make('retire', { id, target: text('target'), reason: text('reason') }, args => withRepo((repo,s) => sync(() => retirePromotion(repo,args.id,args.target,args.reason,s.dryRun)))),
]));
const issue = Command.make('issue').pipe(Command.withDescription('Maintain local observation drafts; no remote GitHub mutations.'), Command.withSubcommands([
  Command.make('draft', { id, title: text('title'), body: optional('body') }, args => withRepo((repo,s) => sync(() => createDocument(repo,'issue',{id:args.id,title:args.title,body:Option.isSome(args.body) ? body(args.body.value) : undefined,dryRun:s.dryRun})))),
  Command.make('list', {}, () => withRepo(repo => sync(() => ({ operation:'issue-list', drafts:loadDocuments(repo).filter(d=>d.metadata.kind==='issue') })))),
  Command.make('show', { id }, args => withRepo(repo => sync(() => ({operation:'issue-show',draft:findDocument(loadDocuments(repo),args.id,'issue')})))),
  Command.make('link', { id, memory: text('memory') }, args => withRepo((repo,s) => sync(() => linkIssue(repo,args.id,args.memory,s.dryRun)))),
  Command.make('close', { id, reason: text('reason') }, args => withRepo((repo,s) => sync(() => closeIssue(repo,args.id,args.reason,s.dryRun)))),
]));
const test = Command.make('test').pipe(Command.withDescription('Discover source annotations and run explicit command verification.'), Command.withSubcommands([
  Command.make('annotate', { id, contract: text('contract'), regression: many('regression') }, args => withRepo(repo => sync(() => annotationSnippet(repo, args.id, args.contract, args.regression)))).pipe(Command.withDescription('Print validated annotations to place above a real test; does not edit or run tests.')),
  Command.make('list', {}, () => withRepo((repo,s) => sync(() => {const t=buildTrace(repo,cached(s.dryRun),{includeCode:false});requireValidTrace(t);return {operation:'test-list',cases:t.annotations.cases,cache:t.annotations.cache};}))),
  Command.make('show', { id }, args => withRepo((repo,s) => sync(() => {const t=buildTrace(repo,cached(s.dryRun),{includeCode:false});requireValidTrace(t);return {operation:'test-show',case:selectCase(t.annotations.cases,args.id),evidenceScope:'command'};}))),
  Command.make('run', { id }, args => withRepo((repo,s) => Effect.gen(function*(){
    if(s.dryRun) return yield* Effect.fail(new ConcordError('InvalidOption','test run does not accept --dry-run; use test show to inspect the declaration'));
    const t=yield* sync(()=>buildTrace(repo,'off',{includeCode:false}));yield* sync(()=>requireValidTrace(t));
    const selected=yield* sync(()=>selectCase(t.annotations.cases,args.id));
    const evidence=yield* runCase(repo,selected,t.documents);
    if(evidence.commandOutcome!=='pass') yield* Effect.sync(()=>{process.exitCode=1;});
    return evidence;
  }))),
  Command.make('evidence', { id }, args => withRepo(repo => sync(()=>readEvidence(repo,args.id)))),
]));
const code = Command.make('code').pipe(Command.withDescription('Associate files, functions and statement regions with Feature or Use Case contracts. No coverage or completion claim.'), Command.withSubcommands([
  Command.make('list', {}, () => withRepo(repo => sync(() => listCode(repo)))).pipe(Command.withDescription('List current declarations from configured sourceRoots.')),
  Command.make('show', { id }, args => withRepo(repo => sync(() => showCode(repo, args.id)))).pipe(Command.withDescription('Inspect one stable code ID, its current range and contract targets.')),
  Command.make('locate', { file: Argument.string('path'), line: Flag.integer('line').pipe(Flag.withDescription('1-based source line; returns every containing scope.')) }, args => withRepo(repo => sync(() => locateCode(repo, args.file, args.line)))).pipe(Command.withDescription('Find all explicit declarations containing a repository-relative source line.')),
  Command.make('annotate', { id, scope: Flag.choice('scope', ['file', 'node', 'region']), contract: many('contract') }, args => withRepo(repo => sync(() => codeSnippet(repo, args.id, args.scope, args.contract)))).pipe(Command.withDescription('Print validated source comments; repeat --contract for multiple targets. Does not edit source.')),
]));
const cache = Command.make('cache').pipe(Command.withDescription('Inspect or rebuild disposable SQLite projections.'),Command.withSubcommands([
  Command.make('status',{},()=>withRepo(repo=>sync(()=>cacheStatus(repo)))),
  Command.make('clear',{},()=>withRepo((repo,s)=>sync(()=>{if(s.dryRun) return {operation:'cache-clear',dryRun:true};return clearCache(repo);}))),
  Command.make('rebuild',{},()=>withRepo((repo,s)=>sync(()=>{if(s.dryRun) throw new ConcordError('InvalidOption','cache rebuild does not accept --dry-run');return scanAnnotations(repo,{cache:'rebuild'});}))),
]));
const check = Command.make('check',{},()=>withRepo((repo,s)=>sync(()=>{const t=buildTrace(repo,cached(s.dryRun));if(t.findings.length)process.exitCode=1;return {operation:'check',ok:t.findings.length===0,findings:t.findings,documents:t.documents.length,cases:t.annotations.cases.length,codeDeclarations:t.codeDeclarations.length,memoryEvidence:t.memories,cache:t.annotations.cache};}))).pipe(Command.withDescription('Validate current source ownership and references; do not execute tests.'));
const trace = Command.make('trace').pipe(Command.withDescription('Derive forward and reverse relationships from current owners.'),Command.withSubcommands([
  Command.make('show',{ref:Argument.string('reference')},args=>withRepo((repo,s)=>sync(()=>traceShow(repo,args.ref,cached(s.dryRun))))),
  Command.make('check',{},()=>withRepo((repo,s)=>sync(()=>{const t=buildTrace(repo,cached(s.dryRun));if(t.findings.length)process.exitCode=1;return {operation:'trace-check',ok:!t.findings.length,findings:t.findings,edges:t.edges};}))),
]));
const review = Command.make('review').pipe(Command.withDescription('Generate local review material from current contracts and history.'),Command.withSubcommands([
  Command.make('render',{ref:Argument.string('reference').pipe(Argument.optional)},args=>withRepo((repo,s)=>sync(()=>renderReview(repo,Option.getOrUndefined(args.ref),cached(s.dryRun))))),
]));
const templates = Command.make('template').pipe(Command.withDescription('Inspect built-in writing templates without a project.'), Command.withSubcommands([
  Command.make('list', {}, () => Effect.gen(function*() { const settings = yield* root; const result = yield* sync(() => ({ operation: 'template-list', templates: listTemplates() })); yield* Effect.sync(() => emit(result, settings.json)); })),
  Command.make('show', { name: Argument.string('name'), title: optional('title') }, args => Effect.gen(function*() { const settings = yield* root; const result = yield* sync(() => ({ operation: 'template-show', name: args.name, body: templateBody(args.name, Option.getOrElse(args.title, () => 'Your title')) })); yield* Effect.sync(() => emit(result, settings.json)); })),
]));
const diagnose = Command.make('doctor', {}, () => withRepo(repo => sync(() => { const result = doctor(repo); if (!result.ok) process.exitCode = 1; return result; }))).pipe(Command.withDescription('Inspect project configuration and onboarding gaps without running tests.'));
root.pipe(Command.withSubcommands([Command.make('repo').pipe(Command.withDescription('Run this worktree repository profile with its original contracts and formal evidence.')),init,recover,...(['feature','use-case','research','design','roadmap','engineering'] as const).map(docsGroup),author,memory,issue,test,code,cache,check,trace,review,templates,diagnose]),Command.run({version:'0.3.0'}),Effect.catch(cause=>Effect.sync(()=>{
  const error=failure(cause);
  const result = {ok:false,error:error.code,message:error.message,...(error.details===undefined?{}:{details:error.details})};
  process.stderr.write(`${process.argv.includes('--json') ? JSON.stringify(result) : humanOutput(result)}\n`);process.exitCode=1;
})),Effect.provide(NodeServices.layer),Effect.provide(OwnedProcessLive),NodeRuntime.runMain);
