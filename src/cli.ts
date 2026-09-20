#!/usr/bin/env node
// @concord-file
// @concord-implements docs/feature/local-sdlc/README.md
// @concord-implements docs/feature/project-onboarding/README.md
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Effect, Option, Schema } from 'effect';
import { Argument, Command, Flag, Prompt } from 'effect/unstable/cli';
import { cacheStatus, clearCache, scanAnnotations } from './annotations.js';
import { activateMemory, addPage, showPage, setPage, adoptRoadmap, closeIssue, createDocument, decideDesign, findDocument, linkFeedbackFeature, linkIssue, loadDocuments, promoteMemory, reopenMemory, resolveMemory, retirePromotion, setAuthor, supersedeMemory } from './documents.js';
import { checkDesign, formatDesign } from './documents.js';
import { listFeedback, syncFeedback } from './feedback.js';
import { FeedbackConnectionSchema } from './feedback-schema.js';
import { setConfig, showConfig } from './editing.js';
import { readEvidence, runCase, verifyFixedEvidence } from './evidence.js';
import { OwnedProcessLive } from './owned-process.js';
import { initialize, LocalRepository } from './storage.js';
import { buildTrace, documentShow, renderReview, requireValidTrace, selectCase, traceShow } from './trace.js';
import { ConcordError, MemorySourceSchema, ProjectSchema, RunnerSchema, decode, failure, type DocumentKind } from './shared.js';
import { listTemplates, templateBody } from './templates.js';
import { humanOutput } from './presentation.js';
import { annotationSnippet, doctor } from './onboarding.js';
import { codeSnippet, listCode, locateCode } from './code-commands.js';
import { applyViewDryRun, executeViewAction, getWorkspaceSnapshot } from './application.js';
import { getGitDiff, getGitStatus } from './git-view.js';
import { serveViewServer } from './view-server.js';
import { viewAddresses } from './view-addresses.js';
import { adoptConstitution, amendConstitution, initializeConstitution, showConstitution } from './constitution.js';

const root = Command.make('concord').pipe(Command.withDescription('Connect product contracts, code and test declarations, and engineering memory. Agent guidance: concord --skill [topic].'), Command.withSharedFlags({
  root: Flag.string('root').pipe(Flag.optional, Flag.withDescription('Consumer Git worktree root; otherwise discover concord.config.ts from cwd; old concord.json requires offline migration.')),
  json: Flag.boolean('json').pipe(Flag.withDefault(false)),
  dryRun: Flag.boolean('dry-run').pipe(Flag.withDefault(false), Flag.withDescription('Validate a document mutation without writing.')),
}));
const text = (name: string) => Flag.string(name);
const optional = (name: string) => text(name).pipe(Flag.optional);
const many = (name: string) => text(name).pipe(Flag.atLeast(0));
const id = Argument.string('id');
function body(path: string): string {
  let source: string;
  try { source = path === '-' ? readFileSync(0, 'utf8') : readFileSync(path, 'utf8'); }
  catch (cause) { throw new ConcordError('InvalidBody', `Cannot read ${path}: ${cause instanceof Error ? cause.message : String(cause)}`); }
  if (Buffer.byteLength(source) > 4 * 1024 * 1024) throw new ConcordError('InvalidBody', 'Author content exceeds 4 MiB');
  return source;
}
function jsonBody<A>(path: string, schema: Schema.ConstraintDecoder<A, never>, label: string): A {
  let value: unknown;
  try { value = JSON.parse(body(path)); }
  catch (cause) { if (cause instanceof ConcordError) throw cause; throw new ConcordError('InvalidJson', `${label} is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`); }
  return decode(schema, value, label);
}
function emit(value: unknown, json: boolean): void {
  const output = json ? JSON.stringify(value) : humanOutput(value);
  process.stdout.write(output.endsWith('\n') ? output : `${output}\n`);
}
function withRepo<A, E, R>(operation: (repo: LocalRepository, settings: { json: boolean; dryRun: boolean }) => Effect.Effect<A, E, R>, options: { initialize?: boolean; recover?: boolean; readonly?: boolean } = {}) {
  return Effect.gen(function*() {
    const settings = yield* root;
    const repo = yield* Effect.acquireRelease(
      Effect.try({ try: () => new LocalRepository(Option.getOrUndefined(settings.root), { initialize: options.initialize, recover: options.recover, dryRun: options.readonly === true || settings.dryRun }), catch: failure }),
      repo => Effect.sync(() => repo.close()),
    );
    return yield* operation(repo, settings).pipe(Effect.tap(result => Effect.sync(() => emit(result, settings.json))));
  }).pipe(Effect.scoped);
}
const sync = <A>(fn: () => A) => Effect.try({ try: fn, catch: failure });
const cached = (dry: boolean) => dry ? 'off' as const : 'use' as const;
const init = Command.make('init', {
  testRoot: many('test-root'), sourceRoot: many('source-root'), docsOnly: Flag.boolean('docs-only').pipe(Flag.withDefault(false)), runnerConfig: optional('runner-config'),
  projectType: Flag.choice('project-type', ['library', 'cli']).pipe(Flag.atLeast(0)), pages: many('pages'), noDefaultPages: Flag.boolean('no-default-pages').pipe(Flag.withDefault(false)),
  design: Flag.boolean('design').pipe(Flag.withDefault(false)), constitutionBody: optional('constitution-body'), adoptConstitution: Flag.boolean('adopt-constitution').pipe(Flag.withDefault(false)),
  constitutionReason: optional('constitution-reason'), constitutionImpact: optional('constitution-impact'), constitutionSource: many('constitution-source'), memorySources: optional('memory-sources'), yes: Flag.boolean('yes').pipe(Flag.withDefault(false)),
}, args => withRepo((repo, s) => Effect.gen(function*() {
  if (args.docsOnly && args.testRoot.length) return yield* Effect.fail(new ConcordError('ConflictingOptions', '--docs-only cannot be combined with --test-root'));
  if (args.noDefaultPages && args.pages.length) return yield* Effect.fail(new ConcordError('ConflictingOptions', '--no-default-pages cannot be combined with --pages'));
  const configFile = Option.getOrUndefined(args.runnerConfig);
  const runner = yield* sync(() => configFile === undefined ? undefined : jsonBody(configFile, RunnerSchema, 'runner configuration'));
  const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;
  const projectTypes = args.projectType.length > 0 ? args.projectType : interactive ? yield* Prompt.run(Prompt.multiSelect({ message: 'Project types', choices: [{ title: 'Library', value: 'library' as const }, { title: 'CLI', value: 'cli' as const }] })) : [];
  const design = args.design || interactive && (yield* Prompt.run(Prompt.confirm({ message: 'Create root DESIGN.md?', initial: false })));
  const selectedPages = args.noDefaultPages ? [] : args.pages.length > 0 ? args.pages.flatMap((value) => value.split(',').map((page) => page.trim())) : undefined;
  const recommendedPages = [...new Set(projectTypes.flatMap((type) => type === 'library' ? ['library', 'architecture'] as const : ['cli', 'architecture'] as const))];
  const pages = selectedPages === undefined && interactive ? yield* Prompt.run(Prompt.multiSelect({ message: 'Default pages for new Feature, Roadmap, and Design documents', choices: [
    { title: 'Library', value: 'library' as const, selected: recommendedPages.includes('library') },
    { title: 'CLI', value: 'cli' as const, selected: recommendedPages.includes('cli') },
    { title: 'Architecture', value: 'architecture' as const, selected: recommendedPages.includes('architecture') },
    { title: 'Lifecycle', value: 'lifecycle' as const },
    { title: 'Use-case index', value: 'use-case' as const },
  ] })) : selectedPages === undefined ? undefined : yield* sync(() => decode(Schema.Array(Schema.Literals(['library', 'cli', 'architecture', 'lifecycle', 'use-case'])), selectedPages, 'default pages'));
  const memoryFile = Option.getOrUndefined(args.memorySources);
  let memorySources = yield* sync(() => memoryFile === undefined ? undefined : [...jsonBody(memoryFile, Schema.NonEmptyArray(MemorySourceSchema), 'Memory sources')]);
  if (memorySources === undefined && interactive) {
    memorySources = [{ name: 'project', provider: 'local-files', path: 'memory', access: 'read-write', defaultWrite: true }];
    while (yield* Prompt.run(Prompt.confirm({ message: 'Add another local-files Memory source?', initial: false }))) {
      const name = yield* Prompt.run(Prompt.text({ message: 'Memory source name' }));
      const path = yield* Prompt.run(Prompt.text({ message: 'Repository-relative Memory directory' }));
      const access = yield* Prompt.run(Prompt.select({ message: 'Memory source access', choices: [{ title: 'Read/write', value: 'read-write' as const }, { title: 'Read-only', value: 'read-only' as const }] }));
      const makeDefault = access === 'read-write' && (yield* Prompt.run(Prompt.confirm({ message: 'Use this as the default write source?', initial: false })));
      if (makeDefault) memorySources = memorySources.map((source) => ({ ...source, defaultWrite: false }));
      memorySources.push({ name, provider: 'local-files', path, access, ...(makeDefault ? { defaultWrite: true } : {}) });
    }
  }
  const memorySourceConfig = yield* sync(() => memorySources === undefined ? undefined : decode(Schema.NonEmptyArray(MemorySourceSchema), memorySources, 'Memory sources'));
  const constitutionBody = yield* sync(() => Option.isSome(args.constitutionBody) ? body(args.constitutionBody.value) : undefined);
  const options = {
    projectId: randomUUID(),
    testRoots: args.docsOnly ? [] : args.testRoot.length ? args.testRoot : undefined, sourceRoots: args.sourceRoot.length ? args.sourceRoot : undefined, runner,
    projectTypes, pages, design, constitutionBody,
    adoptConstitution: args.adoptConstitution, constitutionReason: Option.getOrUndefined(args.constitutionReason), constitutionImpact: Option.getOrUndefined(args.constitutionImpact), constitutionSources: args.constitutionSource, memorySources: memorySourceConfig,
  } as const;
  const preview = yield* sync(() => initialize(repo, true, options));
  if (s.dryRun) return preview;
  const preimages = yield* sync(() => [...preview.createdPaths, ...preview.preservedPaths].map(path => ({ path, source: repo.read(path) })));
  if (interactive) yield* Effect.sync(() => emit({ operation: 'init-preview', configuration: preview.config, create: preview.createdPaths, preserve: preview.preservedPaths }, s.json));
  const confirmed = args.yes || !interactive || (yield* Prompt.run(Prompt.confirm({ message: `Create ${preview.changedPaths.length} files?`, initial: true })));
  if (!confirmed) return { operation: 'init-cancelled', cancelled: true, dryRun: true, changedPaths: [], plannedPaths: preview.changedPaths };
  yield* sync(() => repo.close());
  const writer = yield* Effect.acquireRelease(sync(() => new LocalRepository(repo.root, { initialize: true })), (opened) => Effect.sync(() => opened.close()));
  yield* sync(() => {
    for (const preimage of preimages) if (writer.read(preimage.path) !== preimage.source) throw new ConcordError('PreimageChanged', `${preimage.path} changed since init preview; review a fresh preview`);
  });
  return yield* sync(() => initialize(writer, false, options));
}), { initialize: true, readonly: true })).pipe(Command.withDescription('Progressively initialize static TypeScript configuration, constitution, templates and optional DESIGN.md. Non-TTY uses deterministic defaults; --dry-run previews and an interactive rejection writes nothing.'));
const recover = Command.make('recover', {}, () => withRepo(repo => sync(() => repo.recover()), { recover: true })).pipe(Command.withDescription('Recover interrupted document publication; preserve conflicting external edits.'));

function docsGroup(kind: Exclude<DocumentKind, 'memory' | 'issue'>) {
  const create = Command.make('create', { id, title: text('title'), body: optional('body'), feature: optional('feature'), observedAt: optional('observed-at'), source: many('source'), alternative: many('alternative'), pages: many('pages'), noPages: Flag.boolean('no-pages').pipe(Flag.withDefault(false)), constitutionRef: many('constitution-ref') }, args => withRepo((repo, s) => sync(() => {
    if (args.noPages && args.pages.length) throw new ConcordError('ConflictingOptions', '--no-pages cannot be combined with --pages');
    return createDocument(repo, kind, { id: args.id, title: args.title, body: Option.isSome(args.body) ? body(args.body.value) : undefined, feature: Option.getOrUndefined(args.feature), observedAt: Option.getOrUndefined(args.observedAt), sources: args.source, alternatives: args.alternative, pages: args.noPages ? [] : args.pages.length ? args.pages.flatMap(value => value.split(',').map(page => page.trim())) : undefined, constitutionRefs: args.constitutionRef.length ? args.constitutionRef : undefined, dryRun: s.dryRun });
  }))).pipe(Command.withDescription('Create a writing scaffold. Feature/Roadmap/Design omitted pages use project defaults; --no-pages explicitly creates README only. Feature/Design accept repeated --constitution-ref.'));
  const list = Command.make('list', {}, () => withRepo(repo => sync(() => ({ operation: `${kind}-list`, documents: loadDocuments(repo).filter(d => d.metadata.kind === kind).map(d => ({ path: d.path, ...d.metadata })) }))));
  const show = Command.make('show', { id }, ({ id }) => withRepo((repo, settings) => sync(() => documentShow(repo, id, kind, cached(settings.dryRun)))));
  const adopt = Command.make('adopt', { id, feature: text('feature') }, args => withRepo((repo, s) => sync(() => adoptRoadmap(repo, args.id, args.feature, s.dryRun))));
  const decide = Command.make('decide', { id, selected: text('selected'), target: many('target'), reason: text('reason') }, args => withRepo((repo, s) => sync(() => decideDesign(repo, args.id, args.selected, args.target, args.reason, s.dryRun))));
  const designCheck = Command.make('check', { id }, args => withRepo(repo => sync(() => { const result = checkDesign(repo, args.id); if (!result.ok) process.exitCode = 1; return result; }), { readonly: true }));
  const designFormat = Command.make('format', { id }, args => withRepo((repo, s) => sync(() => formatDesign(repo, args.id, s.dryRun))));
  const pageName = Argument.string('page');
  const page = Command.make('page').pipe(Command.withDescription('Add, inspect, or replace a package page. Use --plan <alternative> for a Design candidate.'), Command.withSubcommands([
    Command.make('add', { id, page: pageName, plan: optional('plan') }, args => withRepo((repo,s) => sync(() => addPage(repo,kind,args.id,args.page,s.dryRun,Option.getOrUndefined(args.plan))))),
    Command.make('show', { id, page: pageName, plan: optional('plan') }, args => withRepo(repo => sync(() => showPage(repo,kind,args.id,args.page,Option.getOrUndefined(args.plan))))),
    Command.make('set', { id, page: pageName, body: text('body'), expectedDigest: text('expected-digest'), plan: optional('plan') }, args => withRepo((repo,s) => sync(() => setPage(repo,kind,args.id,args.page,body(args.body),args.expectedDigest,s.dryRun,Option.getOrUndefined(args.plan))))),
  ]));
  const commands = kind === 'roadmap' ? [create, list, show, page, adopt] : kind === 'design' ? [create, list, show, page, decide, designCheck, designFormat] : kind === 'feature' || kind === 'engineering' || kind === 'research' ? [create, list, show, page] : [create, list, show];
  return Command.make(kind).pipe(Command.withDescription(`Maintain ${kind} contracts.`), Command.withSubcommands(commands));
}
const author = Command.make('author').pipe(Command.withDescription('Edit author prose while retaining managed metadata and history.'), Command.withSubcommands([
  Command.make('set', { ref: Argument.string('reference'), body: text('body'), expectedDigest: text('expected-digest') }, args => withRepo((repo,s) => sync(() => setAuthor(repo, args.ref, body(args.body), args.expectedDigest, s.dryRun)))),
]));
const memoryAdd = Command.make('add', { id, title: text('title'), kind: Flag.choice('kind', ['problem','decision','insight','note']), body: optional('body'), source: optional('source') }, args => withRepo((repo,s) => sync(() => createDocument(repo, 'memory', { id: args.id, title: args.title, body: Option.isSome(args.body) ? body(args.body.value) : undefined, memoryKind: args.kind, memorySource: Option.getOrUndefined(args.source), dryRun: s.dryRun }))));
const memoryList = Command.make('list', {}, () => withRepo(repo => sync(() => ({ operation: 'memory-list', memories: loadDocuments(repo).filter(d => d.metadata.kind === 'memory').map(d => ({path:d.path,...d.metadata})) }))));
const memoryShow = Command.make('show', { id }, args => withRepo((repo, settings) => sync(() => documentShow(repo, args.id, 'memory', cached(settings.dryRun)))));
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
  Command.make('activate', { id, reason: text('reason') }, args => withRepo((repo,s) => sync(() => activateMemory(repo, args.id, args.reason, s.dryRun)))),
  Command.make('reopen', { id, reason: text('reason') }, args => withRepo((repo,s) => sync(() => reopenMemory(repo,args.id,args.reason,s.dryRun)))),
  Command.make('supersede', { id, replacement: text('replacement'), reason: text('reason') }, args => withRepo((repo,s) => sync(() => supersedeMemory(repo,args.id,args.replacement,args.reason,s.dryRun)))),
  Command.make('promote', { id, target: text('target') }, args => withRepo((repo,s) => sync(() => promoteMemory(repo,args.id,args.target,s.dryRun)))),
  Command.make('retire', { id, target: text('target'), reason: text('reason') }, args => withRepo((repo,s) => sync(() => retirePromotion(repo,args.id,args.target,args.reason,s.dryRun)))),
]));
const issue = Command.make('issue').pipe(Command.withDescription('Maintain local observation drafts; no remote GitHub mutations.'), Command.withSubcommands([
  Command.make('draft', { id, title: text('title'), body: optional('body') }, args => withRepo((repo,s) => sync(() => createDocument(repo,'issue',{id:args.id,title:args.title,body:Option.isSome(args.body) ? body(args.body.value) : undefined,dryRun:s.dryRun})))),
  Command.make('list', {}, () => withRepo(repo => sync(() => ({ operation:'issue-list', drafts:loadDocuments(repo).filter(d=>d.metadata.kind==='issue') })))),
  Command.make('show', { id }, args => withRepo((repo, settings) => sync(() => documentShow(repo, args.id, 'issue', cached(settings.dryRun))))),
  Command.make('link', { id, memory: text('memory') }, args => withRepo((repo,s) => sync(() => linkIssue(repo,args.id,args.memory,s.dryRun)))),
  Command.make('close', { id, reason: text('reason') }, args => withRepo((repo,s) => sync(() => closeIssue(repo,args.id,args.reason,s.dryRun)))),
]));
const feedbackConnection = Command.make('connection').pipe(Command.withDescription('Configure feedback providers by credential environment variable name; credentials are never stored.'), Command.withSubcommands([
  Command.make('list', {}, () => withRepo(repo => sync(() => ({ operation: 'feedback-connection-list', connections: repo.config.feedbackConnections ?? [] })))),
  Command.make('add', {
    id: text('id'),
    provider: Flag.choice('provider', ['github', 'linear']),
    credentialEnv: text('credential-env'),
    owner: optional('owner'),
    repo: optional('repo'),
    team: optional('team'),
  }, args => withRepo((local, settings) => sync(() => {
    const owner = Option.getOrUndefined(args.owner), repo = Option.getOrUndefined(args.repo), team = Option.getOrUndefined(args.team);
    if (args.provider === 'github' && (owner === undefined || repo === undefined || team !== undefined)) throw new ConcordError('InvalidOption', 'GitHub connections require --owner and --repo and do not accept --team');
    if (args.provider === 'linear' && (team === undefined || owner !== undefined || repo !== undefined)) throw new ConcordError('InvalidOption', 'Linear connections require --team and do not accept --owner or --repo');
    const connection = decode(FeedbackConnectionSchema, args.provider === 'github'
      ? { id: args.id, provider: args.provider, credentialEnv: args.credentialEnv, owner, repo }
      : { id: args.id, provider: args.provider, credentialEnv: args.credentialEnv, team }, 'feedback connection');
    const current = showConfig(local);
    if ((current.config.feedbackConnections ?? []).some(item => item.id === connection.id)) throw new ConcordError('FeedbackConnectionExists', `Feedback connection ${connection.id} already exists`);
    return setConfig(local, { ...current.config, feedbackConnections: [...(current.config.feedbackConnections ?? []), connection] }, current.digest, settings.dryRun);
  }))),
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
const feedback = Command.make('feedback').pipe(Command.withDescription('Triage local observations and explicitly import or synchronize configured remote feedback.'), Command.withSubcommands([
  Command.make('list', {}, () => withRepo(repo => sync(() => ({ operation: 'feedback-list', feedback: listFeedback(repo) })))),
  Command.make('show', { id }, args => withRepo((repo, settings) => sync(() => {
    const item = listFeedback(repo).find(candidate => candidate.document.metadata.id === args.id);
    if (!item) throw new ConcordError('DocumentNotFound', `No feedback matches ${args.id}`);
    const relations = documentShow(repo, item.document.path, 'issue', cached(settings.dryRun));
    return { operation: 'feedback-show', feedback: { ...item, document: relations.document }, incoming: relations.incoming, outgoing: relations.outgoing, findings: relations.findings };
  }))),
  Command.make('create', { id, title: text('title'), body: optional('body') }, args => withRepo((repo, settings) => sync(() => createDocument(repo, 'issue', { id: args.id, title: args.title, body: Option.isSome(args.body) ? body(args.body.value) : undefined, dryRun: settings.dryRun })))),
  Command.make('link', { id, feature: text('feature') }, args => withRepo((repo, settings) => sync(() => linkFeedbackFeature(repo, args.id, args.feature, settings.dryRun)))),
  Command.make('close', { id, reason: text('reason') }, args => withRepo((repo, settings) => sync(() => closeIssue(repo, args.id, args.reason, settings.dryRun)))),
  feedbackSync,
  feedbackImport,
  feedbackConnection,
]));
const test = Command.make('test').pipe(Command.withDescription('Discover source annotations and run explicit command verification.'), Command.withSubcommands([
  Command.make('annotate', { contract: text('contract'), regression: many('regression') }, args => withRepo(repo => sync(() => annotationSnippet(repo, args.contract, args.regression)))).pipe(Command.withDescription('Print @feature or @use-case path annotations above a real test. Does not edit or run tests.')),
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
const code = Command.make('code').pipe(Command.withDescription('Associate files, functions and statement regions with Feature, Use Case or Engineering contracts. No coverage or completion claim.'), Command.withSubcommands([
  Command.make('list', {}, () => withRepo(repo => sync(() => listCode(repo)))).pipe(Command.withDescription('List current declarations from configured sourceRoots.')),
  Command.make('locate', { file: Argument.string('path'), line: Flag.integer('line').pipe(Flag.withDescription('1-based source line; returns every containing scope.')) }, args => withRepo(repo => sync(() => locateCode(repo, args.file, args.line)))).pipe(Command.withDescription('Find all explicit declarations containing a repository-relative source line.')),
  Command.make('annotate', { scope: Flag.choice('scope', ['file', 'node', 'region']), contract: many('contract') }, args => withRepo(repo => sync(() => codeSnippet(repo, args.scope, args.contract)))).pipe(Command.withDescription('Print validated source comments; repeat --contract for multiple targets. Does not edit source.')),
]));
const cache = Command.make('cache').pipe(Command.withDescription('Inspect or rebuild disposable SQLite projections.'),Command.withSubcommands([
  Command.make('status',{},()=>withRepo(repo=>sync(()=>cacheStatus(repo)))),
  Command.make('clear',{},()=>withRepo((repo,s)=>sync(()=>{if(s.dryRun) return {operation:'cache-clear',dryRun:true};return clearCache(repo);}))),
  Command.make('rebuild',{},()=>withRepo((repo,s)=>sync(()=>{if(s.dryRun) throw new ConcordError('InvalidOption','cache rebuild does not accept --dry-run');return scanAnnotations(repo,{cache:'rebuild'});}))),
]));
const check = Command.make('check',{},()=>withRepo((repo,s)=>sync(()=>{const t=buildTrace(repo,cached(s.dryRun));if(t.findings.length)process.exitCode=1;return {operation:'check',ok:t.findings.length===0,findings:t.findings,advisories:t.advisories,documents:t.documents.length,cases:t.annotations.cases.length,codeDeclarations:t.codeDeclarations.length,memoryEvidence:t.memories,cache:t.annotations.cache};}))).pipe(Command.withDescription('Validate current source ownership and references; do not execute tests.'));
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
const config = Command.make('config').pipe(Command.withDescription('Inspect or replace the normalized project configuration with whole-file CAS.'), Command.withSubcommands([
  Command.make('show', {}, () => withRepo(repo => sync(() => ({ ...showConfig(repo), path: repo.configSnapshot.path, source: repo.configSnapshot.source })))),
  Command.make('set', { input: text('input'), expectedDigest: text('expected-digest') }, args => withRepo((repo, settings) => sync(() => setConfig(repo, decode(ProjectSchema, JSON.parse(body(args.input)), 'configuration input'), args.expectedDigest, settings.dryRun)))),
]));
const constitution = Command.make('constitution').pipe(Command.withDescription('Inspect, initialize, adopt, and amend the single project constitution with CAS.'), Command.withSubcommands([
  Command.make('show', {}, () => withRepo(repo => sync(() => ({ operation: 'constitution-show', constitution: showConstitution(repo), affected: loadDocuments(repo).filter((document) => (document.metadata.kind === 'feature' || document.metadata.kind === 'design') && (document.metadata.constitutionRefs?.length ?? 0) > 0).map((document) => ({ path: document.path, refs: document.metadata.kind === 'feature' || document.metadata.kind === 'design' ? document.metadata.constitutionRefs ?? [] : [] })) })))),
  Command.make('initialize', {}, () => withRepo((repo, settings) => sync(() => initializeConstitution(repo, settings.dryRun)))),
  Command.make('adopt', { body: text('body'), reason: text('reason'), impact: text('impact'), source: many('source'), expectedDigest: text('expected-digest') }, args => withRepo((repo, settings) => sync(() => adoptConstitution(repo, body(args.body), args.reason, args.impact, args.source, args.expectedDigest, settings.dryRun)))),
  Command.make('amend', { version: text('version'), body: text('body'), reason: text('reason'), impact: text('impact'), source: many('source'), expectedDigest: text('expected-digest') }, args => withRepo((repo, settings) => sync(() => amendConstitution(repo, args.version, body(args.body), args.reason, args.impact, args.source, args.expectedDigest, settings.dryRun)))),
]));
const diagnose = Command.make('doctor', {}, () => withRepo(repo => sync(() => { const result = doctor(repo); if (!result.ok) process.exitCode = 1; return result; }))).pipe(Command.withDescription('Inspect project configuration and onboarding gaps without running tests.'));
const viewRoot = (settings: { readonly root: Option.Option<string> }): string => Option.getOrUndefined(settings.root) ?? process.cwd();
const action = Command.make('action', { input: text('input') }, args => Effect.gen(function*() {
  const settings = yield* root;
  const input = yield* sync(() => { try { return applyViewDryRun(JSON.parse(body(args.input)) as unknown, settings.dryRun); } catch (cause) { throw cause instanceof ConcordError ? cause : new ConcordError('InvalidJson', `Action input is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`); } });
  const result = yield* executeViewAction(viewRoot(settings), input);
  yield* Effect.sync(() => emit(result, settings.json));
})).pipe(Command.withDescription('Execute one strict shared ViewAction from --input <file|->.'));
const workspace = Command.make('workspace').pipe(Command.withDescription('Inspect the shared human/agent workspace projection.'), Command.withSubcommands([
  Command.make('show', {}, () => Effect.gen(function*() { const settings = yield* root; const result = yield* getWorkspaceSnapshot(viewRoot(settings), settings.dryRun ? 'off' : 'use'); yield* Effect.sync(() => emit(result, settings.json)); })),
]));
const gitView = Command.make('git').pipe(Command.withDescription('Inspect readonly working-tree status and diffs.'), Command.withSubcommands([
  Command.make('status', {}, () => Effect.gen(function*() { const settings = yield* root; const result = yield* getGitStatus(viewRoot(settings)); yield* Effect.sync(() => emit(result, settings.json)); })),
  Command.make('diff', { path: Argument.string('path'), area: Flag.choice('area', ['staged', 'unstaged', 'untracked']) }, args => Effect.gen(function*() { const settings = yield* root; const result = yield* getGitDiff(viewRoot(settings), args.path, args.area); yield* Effect.sync(() => emit(result, settings.json)); })),
]));
const view = Command.make('view', {
  host: Flag.string('host').pipe(Flag.withDefault('0.0.0.0')),
  port: Flag.integer('port').pipe(Flag.withDefault(4317)),
}, args => Effect.gen(function*() {
  const settings = yield* root;
  if (settings.dryRun) return yield* Effect.fail(new ConcordError('InvalidOption', 'view does not accept --dry-run'));
  return yield* serveViewServer({ root: viewRoot(settings), host: args.host, port: args.port }, (server) => emit({ operation: 'view', root: server.root, host: server.host, port: server.port, address: server.address, ...viewAddresses(server.host, server.port) }, settings.json));
})).pipe(Command.withDescription('Serve the local Web workbench.'));
root.pipe(Command.withSubcommands([Command.make('repo').pipe(Command.withDescription('Manage declared test suites, native evidence and repository governance.')),init,recover,config,constitution,...(['feature','use-case','research','design','roadmap','engineering'] as const).map(docsGroup),author,memory,issue,feedback,test,code,cache,check,trace,review,templates,diagnose,action,workspace,gitView,view]),Command.run({version:'0.5.0'}),Effect.catch(cause=>Effect.sync(()=>{
  const error=failure(cause);
  const result = {ok:false,error:error.code,message:error.message,...(error.details===undefined?{}:{details:error.details})};
  process.stderr.write(`${process.argv.includes('--json') ? JSON.stringify(result) : humanOutput(result)}\n`);process.exitCode=1;
})),Effect.provide(NodeServices.layer),Effect.provide(OwnedProcessLive),NodeRuntime.runMain);
