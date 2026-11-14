// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/use-unified-cache.md
// @concord-implements docs/feature/local-data-engine/cli.md#缓存状态
import { RuntimeEnvironment } from '../../base/environment/index.ts';
import { Workspace } from '../../base/workspace/index.ts';
import { inspectCacheStatus, openHawdb, cacheDatabasePath, type HawdbDatabase } from '../../base/cache/index.ts';
import { Command } from "effect/cli";
import { Effect } from 'effect';
import { ServerLauncher } from './launchers.ts';
import { rebuildCache } from '../../app/index.ts';
import { clearCache, previewCacheClear } from "../../domain/tests/index.ts";
import { ConcordError } from "../../model/index.ts";
import { sync, root, viewRoot, emit } from "./cli-base.ts";
import { withRepo } from "./cli-repository.ts";

const cache = Command.make('cache').pipe(Command.withDescription('Inspect, clear, or rebuild disposable HawDB projections.'),Command.withSubcommands([
  Command.make('status',{},()=>Effect.gen(function*() {
    const settings = yield* root;
    const remote = settings.dryRun ? undefined : yield* (yield* ServerLauncher).cache((yield* viewRoot(settings)), 'cache-status');
    if (remote !== undefined) return yield* emit(remote, settings.json);
    const runtime = yield* RuntimeEnvironment;
    const located = yield* (yield* Workspace).locate(yield* viewRoot(settings));
    const status = yield* sync(() => {
      let database: HawdbDatabase | undefined;
      return inspectCacheStatus(located.privateDir, !settings.dryRun, () => database ??= openHawdb(cacheDatabasePath(located.privateDir), { create: false, readOnly: true }, runtime), () => database?.close(), runtime);
    });
    const identity = yield* Effect.result((yield* ServerLauncher).processIdentity);
    return yield* emit(identity._tag === 'Success'
      ? { ...status, owner: 'process', ...identity.success }
      : { ...status, status: 'unavailable', detail: identity.failure.message, owner: 'process', pid: process.pid }, settings.json);
  })),
  Command.make('clear',{},()=>Effect.gen(function*() {
    const settings = yield* root;
    const remote = settings.dryRun ? undefined : yield* (yield* ServerLauncher).clear((yield* viewRoot(settings)));
    if (remote !== undefined) return yield* emit(remote, settings.json);
    return yield* withRepo((repo,s)=>sync(()=>s.dryRun ? previewCacheClear(repo) : clearCache(repo)));
  })),
  Command.make('rebuild',{},()=>Effect.gen(function*() {
    const settings = yield* root;
    if(settings.dryRun) return yield* Effect.fail(new ConcordError('InvalidOption','cache rebuild does not accept --dry-run'));
    const remote = yield* (yield* ServerLauncher).cache((yield* viewRoot(settings)), 'cache-rebuild');
    if (remote !== undefined) return yield* emit(remote, settings.json);
    return yield* withRepo(repo=>sync(async ()=>(await rebuildCache(repo))));
  })),
]));

export { cache };
