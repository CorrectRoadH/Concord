import { RuntimeEnvironment, makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { PersistentCache } from '../../src/base/cache/index.ts';
import { Installation } from '../../src/base/installation/index.ts';
import { NodeServices } from '@effect/platform-node';
import { Workspace } from '../../src/base/workspace/index.ts';
import { Sources } from '../../src/base/sources/index.ts';
import { ConfigProvider, Effect, Exit, Layer, Scope } from 'effect';
import { LocalRepository as RepositoryBase, type RepositoryOptions } from '../../src/base/workspace/index.ts';
import { Publication } from '../../src/base/publication/index.ts';
import { PublicationValidationLive } from '../../src/app/index.ts';
import { Git } from '../../src/base/git/index.ts';
import { OwnedProcessLive, type OwnedProcess } from '../../src/base/process/index.ts';

const captureRuntime = () => makeRuntimeEnvironment(process.cwd(), process.env);
const publicationBaseLayer = Publication.layer.pipe(Layer.provide(PublicationValidationLive));
export const publicationLayer = publicationBaseLayer.pipe(Layer.provide(Layer.sync(RuntimeEnvironment, captureRuntime)));
export const withPublication = <A, E, R>(operation: Effect.Effect<A, E, R | Publication | RuntimeEnvironment>): Effect.Effect<A, E, Exclude<Exclude<R, Publication>, RuntimeEnvironment>> =>
  operation.pipe(Effect.provide(publicationBaseLayer), Effect.provide(RuntimeEnvironment.layer(captureRuntime())));

/** Test composition root: real validation and the real workspace implementation. */
export class LocalRepository extends RepositoryBase {
  private cacheScope?: Scope.Scope;
  constructor(root?: string, options: RepositoryOptions = {}) {
    const captured = options.runtime ?? captureRuntime();
    const runtime = makeRuntimeEnvironment(captured.cwd, options.environment ?? captured.env);
    const publication = Effect.runSync(Effect.gen(function*() { return yield* Publication; }).pipe(Effect.provide(publicationBaseLayer), Effect.provide(RuntimeEnvironment.layer(runtime))));
    super(root, { ...options, runtime }, publication.validation);
    this.cacheScope = Effect.runSync(Scope.make());
    Effect.runSync(Effect.flatMap(PersistentCache, cache => cache.attach(this)).pipe(Scope.provide(this.cacheScope), Effect.provide(PersistentCache.layer), Effect.provide(RuntimeEnvironment.layer(runtime))));
  }
  override close(): void {
    super.close();
    if (this.cacheScope !== undefined) {
      const scope = this.cacheScope; this.cacheScope = undefined; Effect.runSync(Scope.close(scope, Exit.void));
    }
  }
}
export const runApplication = <A, E>(operation: Effect.Effect<A, E, RuntimeEnvironment | Publication | PersistentCache | Installation | Workspace | Sources | Git | OwnedProcess | NodeServices.NodeServices>, options?: Parameters<typeof Effect.runPromise>[1]) => {
  const runtime = captureRuntime();
  return Effect.runPromise(operation.pipe(Effect.provide(publicationBaseLayer), Effect.provide(Layer.mergeAll(PersistentCache.layer, Installation.layer, Workspace.layer, Sources.layer, Git.layer)), Effect.provide(OwnedProcessLive), Effect.provide(NodeServices.layer), Effect.provide(RuntimeEnvironment.layer(runtime)), Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord(runtime.env)))), options);
};
export const publicationService = () => Effect.runSync(Effect.gen(function*() { return yield* Publication; }).pipe(Effect.provide(publicationLayer)));
export { initialize } from './operations.ts';
