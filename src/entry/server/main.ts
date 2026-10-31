import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { Publication } from "../../base/publication/index.js";
import { PublicationValidationLive } from "../../app/index.js";
import { Workspace } from '../../base/workspace/index.js';
import { Sources } from '../../base/sources/index.js';
import { Cache, CacheSnapshot } from '../../base/cache/index.js';
import type { ChildProcessSpawner } from 'effect/unstable/process';

export const runRefreshMain = <A, E>(operation: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner>): void => {
  NodeRuntime.runMain(operation.pipe(Effect.provide(NodeServices.layer)));
};

export const readerLayer = Layer.mergeAll(Workspace.layer, Sources.layer, Cache.layer, CacheSnapshot.layer()).pipe(Layer.provide(NodeServices.layer));
export const runReaderMain = <A, E>(operation: Effect.Effect<A, E, Workspace | Sources | Cache | CacheSnapshot>): void => {
  NodeRuntime.runMain(operation.pipe(Effect.provide(readerLayer)));
};

/** Computation entries don't call this writer composition root. */
export const runWriterMain = <A, E>(operation: Effect.Effect<A, E, Publication | Workspace | Sources | Cache | CacheSnapshot>): void => {
  NodeRuntime.runMain(operation.pipe(Effect.provide(Publication.layer.pipe(Layer.provide(PublicationValidationLive))), Effect.provide(readerLayer)));
};
