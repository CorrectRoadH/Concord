// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#cli-查询
import { Context, Effect, Layer, Schema } from 'effect';
import type { executeQuery } from './queries.js';

export const QueryReply = Schema.Struct({ value: Schema.Json, exitCode: Schema.Literals([0, 1]) }).annotate({ parseOptions: { onExcessProperty: 'error' } });
export type QueryReply = typeof QueryReply.Type;
export class Queries extends Context.Service<Queries, { readonly execute: typeof executeQuery }>()('concord/app/Queries') {
  static readonly Local = Layer.unwrap(Effect.promise(() => import('./queries.js')).pipe(Effect.map(module => Layer.succeed(Queries, Queries.of({ execute: module.executeQuery })))));
  static Remote(execute: typeof executeQuery) { return Layer.succeed(Queries, Queries.of({ execute })); }
}
