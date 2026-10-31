// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/use-unified-cache.md
import { Command } from "effect/unstable/cli";
import { Effect } from 'effect';
import { ServerLauncher } from './launchers.js';
import { cacheStatus, clearCache, previewCacheClear, scanAnnotations } from "../../app/index.js";
import { ConcordError } from "../../model/index.js";
import { scanCode } from "../../app/index.js";
import { sync, root, viewRoot, emit } from "./cli-base.js";
import { withRepo, withReadRepo } from "./cli-repository.js";

const cache = Command.make('cache').pipe(Command.withDescription('Inspect, clear, or rebuild disposable HawDB projections.'),Command.withSubcommands([
  Command.make('status',{},()=>withReadRepo(repo=>sync(()=>cacheStatus(repo)))),
  Command.make('clear',{},()=>Effect.gen(function*() {
    const settings = yield* root;
    const remote = settings.dryRun ? undefined : yield* (yield* ServerLauncher).clear(viewRoot(settings));
    if (remote !== undefined) return yield* Effect.sync(() => emit(remote, settings.json));
    return yield* withRepo((repo,s)=>sync(()=>s.dryRun ? previewCacheClear(repo) : clearCache(repo)));
  })),
  Command.make('rebuild',{},()=>withRepo((repo,s)=>sync(()=>{
    if(s.dryRun) throw new ConcordError('InvalidOption','cache rebuild does not accept --dry-run');
    const annotations=scanAnnotations(repo,{cache:'rebuild'});
    const code=scanCode(repo,{cache:'rebuild'});
    const status=cacheStatus(repo);
    if(annotations.cache.status !== 'miss' || !['miss','hit'].includes(code.cache.status) || status.status !== 'ready') {
      throw new ConcordError('CacheRebuildUnavailable','Cache rebuild did not produce readable current projections',{cache:annotations.cache,codeCache:code.cache,cacheStatus:status});
    }
    return {...annotations,codeCache:code.cache,cacheStatus:status};
  }))),
]));

export { cache };
