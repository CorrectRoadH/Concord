import { Context, Effect, Layer, Path, type Scope } from 'effect';
import { failure, type ConcordError } from '../../model/index.ts';
import type { Publication } from '../publication/index.ts';
import type { LocalRepository, ReadRepositoryOptions, RepositoryOptions } from './storage.ts';
import type { inspectConfiguration } from './config-inspection.ts';
import { identifyWorkspace, locateWorkspace } from './identity.ts';

const repository = () => Effect.tryPromise(() => import('./repository-service.ts')).pipe(Effect.mapError(failure));

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
      return Workspace.of({ openRead, openWrite, inspectConfiguration: (...args) => Effect.tryPromise(() => import('./config-inspection.ts')).pipe(Effect.flatMap(module => module.inspectConfiguration(...args)), Effect.mapError(failure)), identify: identifyWorkspace, locate: locateWorkspace });
    }));
  }
  static readonly layer = Workspace.layerWithEnvironment();
}
