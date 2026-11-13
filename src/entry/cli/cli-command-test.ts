// @concord-file
// @concord-implements docs/feature/local-sdlc/cli.md#测试与修复核验
// @concord-implements docs/feature/local-sdlc/cli.md#原生测试-adapter
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { collectNativeTests, runCase, verifyTest, verifyChanges } from "../../domain/tests/index.ts";
import { buildTrace, requireValidTrace, selectCase } from "../../domain/trace/index.ts";
import { annotationSnippet } from "../../domain/onboarding/index.ts";
import { locateProjectRoot } from "../../app/index.ts";
import { ConcordError } from "../../model/index.ts";
import { root, emit, text, optional, many, id, sync, cached } from "./cli-base.ts";
import { withRepo, withReadRepo, withQuery } from "./cli-repository.ts";
import { setExitCode } from './invocation.ts';

const test = Command.make('test').pipe(Command.withDescription('Discover source annotations and run explicit command verification.'), Command.withSubcommands([
  Command.make('marker', { contract: text('contract'), issue: many('issue') }, args => withReadRepo(repo => sync(() => annotationSnippet(repo, args.contract, args.issue)))).pipe(Command.withDescription('Print @feature or @use-case markers for a test file. Does not edit or run tests.')),
  Command.make('list', {}, () => withQuery({ name: 'test.list', input: {} })),
  Command.make('show', { id }, args => withQuery({ name: 'test.show', input: { id: args.id } })),
  Command.make('discover', { files: Argument.String('file').pipe(Argument.variadic()) }, args => withRepo((repo,s) => s.dryRun ? Effect.fail(new ConcordError('InvalidOption','test discover does not accept --dry-run')) : collectNativeTests(repo,args.files), { unlocked:true, cacheRequired:true })).pipe(Command.withDescription('Run configured native test adapters and save disposable discovery observations.')),
  Command.make('run', { id, requireNative: Flag.Boolean('require-native').pipe(Flag.withDefault(false)) }, args => withRepo((repo,s) => Effect.gen(function*(){
    if(s.dryRun) return yield* Effect.fail(new ConcordError('InvalidOption','test run does not accept --dry-run; use test show to inspect the declaration'));
    const t=yield* sync(async ()=>(await repo.snapshot(async ()=>(await buildTrace(repo,'off',{includeCode:false})))));yield* sync(()=>requireValidTrace(t));
    const selected=yield* sync(()=>selectCase(t.annotations.cases,args.id));
    const evidence=yield* runCase(repo,selected,t.documents,{requireNative:args.requireNative});
    if(evidence.commandOutcome!=='pass' && evidence.commandOutcome!=='green') yield* setExitCode(1);
    return evidence;
  }), { unlocked: true })),
  Command.make('verify', { ids: Argument.String('id').pipe(Argument.variadic()), staged: Flag.Boolean('staged').pipe(Flag.withDefault(false)), defect: optional('defect'), fix: optional('fix') }, args => Effect.gen(function* () {
    const settings = yield* root;
    if (settings.dryRun) return yield* Effect.fail(new ConcordError('InvalidOption', 'test verify does not accept --dry-run'));
    const defect = Option.getOrUndefined(args.defect), fix = Option.getOrUndefined(args.fix);
    if (args.staged) {
      if (defect !== undefined || fix !== undefined || args.ids.length) return yield* Effect.fail(new ConcordError('InvalidOption', '--staged cannot be combined with --defect, --fix or test IDs'));
      const result = yield* verifyChanges(yield* locateProjectRoot(Option.getOrUndefined(settings.root)));
      yield* emit(result, settings.json); return result;
    }
    if (fix !== undefined && defect === undefined && args.ids.length === 0) {
      const result = yield* verifyChanges(yield* locateProjectRoot(Option.getOrUndefined(settings.root)), fix);
      yield* emit(result, settings.json); return result;
    }
    if (defect === undefined || fix === undefined || args.ids.length !== 1) return yield* Effect.fail(new ConcordError('InvalidOption', 'Use --staged, --fix <commit>, or --defect <commit> --fix <commit> <test-id>'));
    return yield* withRepo(repo => verifyTest(repo, args.ids[0]!, defect, fix), { unlocked: true, readonly: true });
  })),
]));

export { test };
