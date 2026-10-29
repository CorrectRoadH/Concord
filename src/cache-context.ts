// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/use-unified-cache.md
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Repository } from './shared.js';

/** Only synchronous source snapshots supply persistent parse-cache access. */
const current = new AsyncLocalStorage<Repository>();
const disabled = new AsyncLocalStorage<boolean>();
export const currentCacheRepository = (): Repository | undefined => disabled.getStore() ? undefined : current.getStore();
export function withCacheRepository<A>(repo: Repository, read: () => A): A { return current.run(repo, read); }
export function withParseCachePolicy<A>(enabled: boolean, read: () => A): A { return disabled.run(!enabled || disabled.getStore() === true, read); }
