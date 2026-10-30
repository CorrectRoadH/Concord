// @concord-file
// @concord-implements docs/feature/local-sdlc/cli.md#测试与修复核验
// @concord-implements docs/feature/local-sdlc/cli.md#原生测试-adapter
import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { collectNativeTests, readNativeObservations } from "../../app/index.js";
import { runCase } from "../../app/index.js";
import { replayFix } from "../../app/index.js";
import { buildTrace, requireValidTrace, selectCase } from "../../app/index.js";
import { ConcordError } from "../../model/index.js";
import { annotationSnippet } from "../../app/index.js";
import { analysisView } from "../../app/index.js";
import { scanCode } from "../../app/index.js";
import { text, many, id, sync, cached } from "./cli-base.js";
import { withRepo, withReadRepo } from "./cli-repository.js";

const test = Command.make('test').pipe(Command.withDescription('Discover source annotations and run explicit command verification.'), Command.withSubcommands([
  Command.make('annotate', { contract: text('contract'), issue: many('issue') }, args => withReadRepo(repo => sync(() => annotationSnippet(repo, args.contract, args.issue)))).pipe(Command.withDescription('Print @feature or @use-case markers for a test file. Does not edit or run tests.')),
  Command.make('list', {}, () => withReadRepo((repo,s) => sync(() => {const t=buildTrace(repo,cached(s.dryRun),{includeCode:false});requireValidTrace(t);return {operation:'test-list',cases:t.annotations.cases,cache:t.annotations.cache,observations:readNativeObservations(repo)};}))),
  Command.make('show', { id }, args => withReadRepo((repo,s) => sync(() => {const t=buildTrace(repo,cached(s.dryRun),{includeCode:false});requireValidTrace(t);const selected=selectCase(t.annotations.cases,args.id);let codes: ReturnType<typeof scanCode>['codes']=[];try{codes=scanCode(repo,{cache:'off'}).codes;}catch{/* Optional observations do not block test inspection. */}return {operation:'test-show',case:selected,evidenceScope:'command',analysis:analysisView(repo,[selected],codes,t.documents),observations:readNativeObservations(repo)};}))),
  Command.make('collect', { files: Argument.string('file').pipe(Argument.variadic()) }, args => withRepo((repo,s) => s.dryRun ? Effect.fail(new ConcordError('InvalidOption','test collect does not accept --dry-run')) : collectNativeTests(repo,args.files), { unlocked:true })),
  Command.make('run', { id, requireNative: Flag.boolean('require-native').pipe(Flag.withDefault(false)) }, args => withRepo((repo,s) => Effect.gen(function*(){
    if(s.dryRun) return yield* Effect.fail(new ConcordError('InvalidOption','test run does not accept --dry-run; use test show to inspect the declaration'));
    const t=yield* sync(()=>repo.snapshot(()=>buildTrace(repo,'off',{includeCode:false})));yield* sync(()=>requireValidTrace(t));
    const selected=yield* sync(()=>selectCase(t.annotations.cases,args.id));
    const evidence=yield* runCase(repo,selected,t.documents,{requireNative:args.requireNative});
    if(evidence.commandOutcome!=='pass' && evidence.commandOutcome!=='green') yield* Effect.sync(()=>{process.exitCode=1;});
    return evidence;
  }), { unlocked: true })),
  Command.make('verify', { id }, args => withRepo((repo,s) => s.dryRun ? Effect.fail(new ConcordError('InvalidOption', 'test verify does not accept --dry-run')) : replayFix(repo,args.id), { unlocked:true, readonly:true })),
]));

export { test };
