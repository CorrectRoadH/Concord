import { Context, Effect, Layer, Path, type Scope } from 'effect';
import { failure, type ConcordError } from '../../model/index.js';
import type { Publication } from '../publication/index.js';
import type { LocalRepository, ReadRepositoryOptions, RepositoryOptions } from './storage.js';
import type { inspectConfiguration } from './config-inspection.js';
import { identifyWorkspace, locateWorkspace } from './identity.js';

const repository = () => Effect.tryPromise(() => import('./repository-service.js')).pipe(Effect.mapError(failure));

export interface WorkspaceService {
  readonly locate: typeof locateWorkspace;
  readonly identify: typeof identifyWorkspace;
  readonly inspectConfiguration: typeof inspectConfiguration;
  readonly openRead: (root: string | undefined, options: ReadRepositoryOptions) => Effect.Effect<LocalRepository, ConcordError, Scope.Scope>;
  readonly openWrite: (root: string | undefined, options?: RepositoryOptions) => Effect.Effect<LocalRepository, ConcordError, Publication | Scope.Scope>;
}

/** A repository and its configuration are operation scoped, never layer scoped. */
export class Workspace extends Context.Service<Workspace, WorkspaceService>()('concord/base/workspace/Workspace') {
  static layerWithEnvironment(environment?: Readonly<Record<string, string>>) {
    return Layer.effect(Workspace, Effect.gen(function*() {
      const path = yield* Path.Path;
      const openRead: WorkspaceService['openRead'] = (root, options) => repository().pipe(Effect.flatMap(module => module.openRead(root === undefined ? root : path.resolve(root), { ...options, ...(environment === undefined ? {} : { environment }) })));
      const openWrite: WorkspaceService['openWrite'] = (root, options) => repository().pipe(Effect.flatMap(module => module.openWrite(root === undefined ? root : path.resolve(root), { ...options, ...(environment === undefined ? {} : { environment }) })));
      return Workspace.of({ openRead, openWrite, inspectConfiguration: (...args) => Effect.tryPromise(() => import('./config-inspection.js')).pipe(Effect.flatMap(module => module.inspectConfiguration(...args)), Effect.mapError(failure)), identify: identifyWorkspace, locate: locateWorkspace });
    }));
  }
  static readonly layer = Workspace.layerWithEnvironment();
}
