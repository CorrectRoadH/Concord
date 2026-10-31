// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#操作依赖
import { Effect, Option } from 'effect';
import { CacheSnapshot, PersistentCache } from '../cache/index.js';
import { Publication } from '../publication/index.js';
import { failure } from '../../model/index.js';
import { LocalRepository, type ReadRepositoryOptions, type RepositoryOptions } from './storage.js';

const attachCache = Effect.fn('Workspace.attachCache')(function*(repo: LocalRepository) {
  const persistent = yield* Effect.serviceOption(PersistentCache);
  if (Option.isSome(persistent)) return yield* persistent.value.attach(repo).pipe(Effect.mapError(failure));
  const snapshot = yield* Effect.serviceOption(CacheSnapshot);
  if (Option.isSome(snapshot)) yield* snapshot.value.attach(repo).pipe(Effect.mapError(failure));
});

export const openRead = Effect.fn('Workspace.openRead')(function*(root: string | undefined, options: ReadRepositoryOptions) {
  const persistent = yield* Effect.serviceOption(PersistentCache);
  const selected = Option.isSome(persistent) ? options : { ...options, persistentCache: 'off' as const };
  const repo = yield* Effect.acquireRelease(Effect.try({ try: () => new LocalRepository(root, selected), catch: failure }), repo => Effect.sync(() => repo.close()));
  yield* attachCache(repo);
  return repo;
});
export const openWrite = Effect.fn('Workspace.openWrite')(function*(root: string | undefined, options: RepositoryOptions = {}) {
  const publication = yield* Publication;
  const persistent = yield* Effect.serviceOption(PersistentCache);
  const selected = Option.isSome(persistent) ? options : { ...options, persistentCache: 'off' as const };
  const repo = yield* Effect.acquireRelease(Effect.try({ try: () => new LocalRepository(root, selected, publication.validation), catch: failure }), repo => Effect.sync(() => repo.close()));
  yield* attachCache(repo);
  return repo;
});
