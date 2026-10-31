import { Effect, Layer } from 'effect';
import { Publication } from '../base/publication/index.js';
import { IssuePlanStore, type IssuePlanStoreService } from '../domain/issues/index.js';

export const makeNodeIssuePlanStore = Effect.fn('Publication.issuePlanStore')(function*(root: string): Effect.fn.Return<IssuePlanStoreService, never, Publication> {
  return (yield* Publication).receiptStore(root);
});
export const NodeIssuePlanStoreLive = (root: string) => Layer.effect(IssuePlanStore, makeNodeIssuePlanStore(root));
