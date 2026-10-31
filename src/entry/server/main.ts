import { Installation } from '../../base/installation/index.js';
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { Publication } from "../../base/publication/index.js";
import { PublicationValidationLive } from "../../app/index.js";
import { Workspace } from '../../base/workspace/index.js';
import { Sources } from '../../base/sources/index.js';
import { Cache, CacheSnapshot, PersistentCache } from '../../base/cache/index.js';
import type { ChildProcessSpawner } from 'effect/unstable/process';

export const refreshLayer = Layer.merge(Workspace.layer, PersistentCache.layer).pipe(Layer.provideMerge(NodeServices.layer));
export const runRefreshMain = <A, E>(operation: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner | Workspace | PersistentCache>): void => {
  NodeRuntime.runMain(operation.pipe(Effect.provide(refreshLayer)));
};

export const readerLayer = Layer.mergeAll(PersistentCache.layer, Installation.layer, Workspace.layer, Sources.layer, Cache.layer, CacheSnapshot.layer()).pipe(Layer.provide(NodeServices.layer));
export const runReaderMain = <A, E>(operation: Effect.Effect<A, E, Installation | Workspace | Sources | Cache | CacheSnapshot>): void => {
  NodeRuntime.runMain(operation.pipe(Effect.provide(readerLayer)));
};

/** Computation entries don't call this writer composition root. */
export const writerLayer = Layer.mergeAll(Publication.layer.pipe(Layer.provide(PublicationValidationLive)), PersistentCache.layer).pipe(Layer.provideMerge(readerLayer));
export const runWriterMain = <A, E>(operation: Effect.Effect<A, E, Publication | PersistentCache | Installation | Workspace | Sources | Cache | CacheSnapshot | PersistentCache>): void => {
  NodeRuntime.runMain(operation.pipe(Effect.provide(writerLayer)));
};
