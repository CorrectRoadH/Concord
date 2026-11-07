// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#操作依赖
import { Effect, Option } from 'effect';
import { CacheSnapshot, PersistentCache } from '../cache/index.ts';
import { Publication } from '../publication/index.ts';
import { failure } from '../../model/index.ts';
import { LocalRepository, type ReadRepositoryOptions, type RepositoryOptions } from './storage.ts';
import type { RuntimeEnvironmentSnapshot } from '../environment/index.ts';
import type { WorkspaceMetadata, WorkspaceOpenOptions } from './context.ts';

export const openMetadata = Effect.fn('Workspace.open')((root: string | undefined, options: WorkspaceOpenOptions, runtime: RuntimeEnvironmentSnapshot) => Effect.try({
  try: (): WorkspaceMetadata => {
    const reader = new LocalRepository(root, { access: 'read', optimistic: true, persistentCache: 'off', reclaimPublication: false, runtime });
    try {
      return Object.freeze({ root: reader.root, privateDir: reader.privateDir, configuration: reader.configSnapshot, config: reader.config, access: options.access, cache: options.cache });
    } finally { reader.close(); }
  }, catch: failure,
}));

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
