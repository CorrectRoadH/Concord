import { NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { Publication } from "../../base/publication/index.js";
import { PublicationValidationLive } from "../../app/index.js";

/** Computation entries don't call this writer composition root. */
export const runWriterMain = <A, E>(operation: Effect.Effect<A, E, Publication>): void => {
  NodeRuntime.runMain(operation.pipe(Effect.provide(Publication.layer.pipe(Layer.provide(PublicationValidationLive)))));
};
