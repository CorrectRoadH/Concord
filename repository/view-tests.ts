import { NodeServices } from '@effect/platform-node';
import { Effect } from 'effect';
import { compileTraceUnderLease } from './docs/trace/compiler.js';
import { repositoryConfiguration } from './root.js';
import { showFeature } from './docs/trace/index.js';

/** The caller owns the repository lease. This projection never loads host code or runs tests. */
export const readViewTests = Effect.fn('repository.readViewTests')(function*(root: string) {
  yield* Effect.try({ try: () => repositoryConfiguration(root), catch: cause => cause });
  const snapshot = yield* compileTraceUnderLease(root);
  const features = new Map<string, string[]>();
  for (const feature of snapshot.nodes.filter(node => node.kind === 'feature')) {
    const receipt = yield* showFeature(snapshot, feature.path);
    for (const test of receipt.tests) {
      const paths = features.get(test.selector) ?? [];
      paths.push(feature.path);
      features.set(test.selector, paths);
    }
  }
  return snapshot.tests.map(test => ({
    id: test.caseId, name: test.title ?? test.selector, file: test.path,
    selector: test.selector, contract: test.contract,
    features: features.get(test.selector) ?? [],
  }));
}, Effect.provide(NodeServices.layer));
