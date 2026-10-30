import { Effect, Layer } from "effect";
import { Publication } from "../../base/publication/index.js";
import { PublicationValidationLive, openWriteRepository } from "../../app/index.js";

const publication = Publication.layer.pipe(Layer.provide(PublicationValidationLive));
export const runOperation = <A, E>(operation: Effect.Effect<A, E, Publication>, options?: { readonly signal?: AbortSignal }) =>
  Effect.runPromise(operation.pipe(Effect.provide(publication)), options);

export const openHttpWriter = (root: string) => runOperation(openWriteRepository(root));
