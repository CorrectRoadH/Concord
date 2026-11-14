// @concord-file
// @concord-implements docs/engineering/code/architecture.md#基础服务
import { join } from 'node:path';
import { Effect } from 'effect';
import { RuntimeEnvironment, makeRuntimeEnvironment, type RuntimeEnvironmentSnapshot } from '../environment/index.ts';
import { nativeArtifactRoot, nativeFileIdentity, hawdbTarget, hawdbLibraryName } from '../installation/index.ts';
import { createMemoryHawdb, verifyHawdbArtifact, HawdbFailure, type HawdbDatabase } from './hawdb-native.ts';

const bindings = new WeakMap<RuntimeEnvironmentSnapshot, { readonly owner: ContentCacheOwner; readonly project: string }>();

/** An entry owns bounded parse handles; repositories and pure parsers only borrow them. */
export class ContentCacheOwner {
  private readonly databases = new Map<string, { readonly selection: string; readonly identity: string; readonly project: string; readonly database: HawdbDatabase }>();
  private closed = false;
  private readonly native: boolean;
  constructor(native = true) { this.native = native; }

  bind(runtime: RuntimeEnvironmentSnapshot, project = runtime.cwd): RuntimeEnvironmentSnapshot {
    const bound = makeRuntimeEnvironment(runtime.cwd, runtime.env);
    bindings.set(bound, { owner: this, project });
    return bound;
  }

  database(runtime: RuntimeEnvironmentSnapshot, project: string, partition: string): HawdbDatabase | undefined {
    if (this.closed) throw new HawdbFailure('HawdbClosed', 'The parse cache owner is closed');
    if (!this.native) return undefined;
    const selection = join(nativeArtifactRoot(runtime), hawdbTarget());
    const fingerprint = () => JSON.stringify([hawdbLibraryName(hawdbTarget()), 'artifact.json', 'manifest.json', 'include/hawdb_ffi.h', 'LICENSE'].map(name => nativeFileIdentity(join(selection, name))));
    try {
      // Reuse byte/Schema evidence only while every guarded input has the same identity.
      const identity = fingerprint();
      const key = JSON.stringify([project, selection, identity, partition]);
      const prior = this.databases.get(key);
      if (prior) {
        this.databases.delete(key);
        this.databases.set(key, prior);
        return prior.database;
      }
      verifyHawdbArtifact(runtime);
      for (const [oldKey, old] of this.databases) {
        if (old.project === project && old.selection === selection && old.identity !== identity) {
          this.databases.delete(oldKey);
          old.database.close();
        }
      }
      // Each parser retains its own namespace quota; config writes cannot evict document rows.
      if (this.databases.size >= 32) {
        const oldest = this.databases.keys().next().value!;
        const evicted = this.databases.get(oldest)!;
        this.databases.delete(oldest);
        evicted.database.close();
      }
      const database = createMemoryHawdb(runtime);
      try {
        if (fingerprint() !== identity) throw new HawdbFailure('HawdbIncompatible', 'Native inputs changed while opening a parse cache');
      } catch (cause) { database.close(); throw cause; }
      this.databases.set(key, { project, selection, identity, database });
      return database;
    } catch (cause) {
      for (const [key, prior] of this.databases) {
        if (prior.project === project && prior.selection === selection) {
          this.databases.delete(key);
          prior.database.close();
        }
      }
      throw cause;
    }
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
export const withContentCacheOwner = <A, E, R>(operation: Effect.Effect<A, E, R>, native = true) => Effect.scoped(Effect.gen(function*() {
  const runtime = yield* RuntimeEnvironment;
  const owner = yield* Effect.acquireRelease(Effect.sync(() => new ContentCacheOwner(native)), value => Effect.sync(() => value.close()));
  return yield* operation.pipe(Effect.provideService(RuntimeEnvironment, owner.bind(runtime)));
}));
