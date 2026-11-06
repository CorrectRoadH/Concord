// @concord-file
// @concord-implements docs/engineering/code/architecture.md#基础服务
import { join } from 'node:path';
import { Effect } from 'effect';
import { RuntimeEnvironment, makeRuntimeEnvironment, type RuntimeEnvironmentSnapshot } from '../environment/index.ts';
import { nativeArtifactRoot, nativeFileIdentity, hawdbTarget } from '../installation/index.ts';
import { createMemoryHawdb, verifyHawdbArtifact, type HawdbDatabase } from './hawdb-native.ts';

const bindings = new WeakMap<RuntimeEnvironmentSnapshot, { readonly owner: ContentCacheOwner; readonly project: string }>();

/** An entry owns bounded parse handles; repositories and pure parsers only borrow them. */
export class ContentCacheOwner {
  private readonly databases = new Map<string, { readonly selection: string; readonly identity: string; readonly project: string; readonly database: HawdbDatabase }>();
  private closed = false;

  bind(runtime: RuntimeEnvironmentSnapshot, project = runtime.cwd): RuntimeEnvironmentSnapshot {
    const bound = makeRuntimeEnvironment(runtime.cwd, runtime.env);
    bindings.set(bound, { owner: this, project });
    return bound;
  }

  database(runtime: RuntimeEnvironmentSnapshot, project: string, partition: string): HawdbDatabase | undefined {
    if (this.closed) return undefined;
    // Verification precedes lookup: a still-open binding never authorizes replaced bytes.
    const selection = join(nativeArtifactRoot(runtime), hawdbTarget());
    try { verifyHawdbArtifact(runtime); }
    catch (cause) {
      for (const [key, prior] of this.databases) {
        if (prior.project === project && prior.selection === selection) {
          this.databases.delete(key);
          prior.database.close();
        }
      }
      throw cause;
    }
    const identity = JSON.stringify(['hawdb.node', 'artifact.json', 'THIRD-PARTY-NOTICES.txt'].map(name => nativeFileIdentity(join(selection, name))));
    for (const [key, prior] of this.databases) {
      if (prior.project === project && prior.selection === selection && prior.identity !== identity) {
        this.databases.delete(key);
        prior.database.close();
      }
    }
    const key = JSON.stringify([project, selection, identity, partition]);
    const prior = this.databases.get(key);
    if (prior) {
      this.databases.delete(key);
      this.databases.set(key, prior);
      return prior.database;
    }
    // Each parser retains its own namespace quota; config writes cannot evict document rows.
    if (this.databases.size >= 32) {
      const oldest = this.databases.keys().next().value!;
      const evicted = this.databases.get(oldest)!;
      this.databases.delete(oldest);
      evicted.database.close();
    }
    const database = createMemoryHawdb(runtime);
    this.databases.set(key, { project, selection, identity, database });
    return database;
  }

  close(): void {
    this.closed = true;
    const failures: unknown[] = [];
    for (const entry of this.databases.values()) {
      try { entry.database.close(); } catch (cause) { failures.push(cause); }
    }
    this.databases.clear();
    if (failures.length > 0) throw new AggregateError(failures, 'Parse cache handles could not all close');
  }
}

/** Cloning a call snapshot preserves its entry owner while retaining the actual project. */
export function inheritContentCacheOwner(runtime: RuntimeEnvironmentSnapshot, source: RuntimeEnvironmentSnapshot | undefined, project?: string): RuntimeEnvironmentSnapshot {
  const binding = source === undefined ? undefined : bindings.get(source);
  return binding === undefined ? runtime : binding.owner.bind(runtime, project ?? binding.project);
}

export function ownedContentCache(runtime: RuntimeEnvironmentSnapshot, partition: string): { readonly owned: boolean; readonly database: HawdbDatabase | undefined } {
  const binding = bindings.get(runtime);
  return binding === undefined ? { owned: false, database: undefined } : { owned: true, database: binding.owner.database(runtime, binding.project, partition) };
}

/** CLI invocations and process roots establish independent scopes, never a global first caller. */
export const withContentCacheOwner = <A, E, R>(operation: Effect.Effect<A, E, R>) => Effect.scoped(Effect.gen(function*() {
  const runtime = yield* RuntimeEnvironment;
  const owner = yield* Effect.acquireRelease(Effect.sync(() => new ContentCacheOwner()), value => Effect.sync(() => value.close()));
  return yield* operation.pipe(Effect.provideService(RuntimeEnvironment, owner.bind(runtime)));
}));
