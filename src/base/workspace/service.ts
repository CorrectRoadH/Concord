import { Context, Effect, Layer, type Scope } from 'effect';
import { RuntimeEnvironment, makeRuntimeEnvironment } from '../environment/index.ts';
import { failure, type ConcordError } from '../../model/index.ts';
import type { Publication } from '../publication/index.ts';
import type { LocalRepository, ReadRepositoryOptions, RepositoryOptions } from './storage.ts';
import type { inspectConfiguration } from './config-inspection.ts';
import { identifyWorkspace, locateWorkspace } from './identity.ts';

const repository = () => Effect.tryPromise(() => import('./repository-service.ts')).pipe(Effect.mapError(failure));

export interface WorkspaceService {
  readonly locate: (input: string | undefined, allowUninitialized?: boolean) => ReturnType<typeof locateWorkspace>;
  readonly identify: (input: string | undefined, allowUninitialized?: boolean, strictFile?: boolean) => ReturnType<typeof identifyWorkspace>;
  readonly inspectConfiguration: (root: string) => ReturnType<typeof inspectConfiguration>;
  readonly openRead: (root: string | undefined, options: ReadRepositoryOptions) => Effect.Effect<LocalRepository, ConcordError, Scope.Scope>;
  readonly openWrite: (root: string | undefined, options?: RepositoryOptions) => Effect.Effect<LocalRepository, ConcordError, Publication | Scope.Scope>;
}

/** A repository and its configuration are operation scoped, never layer scoped. */
export class Workspace extends Context.Service<Workspace, WorkspaceService>()('concord/base/workspace/Workspace') {
  static layerWithEnvironment(environment?: Readonly<Record<string, string | undefined>>) {
    return Layer.effect(Workspace, Effect.gen(function*() {
      const current = yield* RuntimeEnvironment;
      const runtime = environment === undefined ? current : makeRuntimeEnvironment(current.cwd, environment);
      const openRead: WorkspaceService['openRead'] = (root, options) => repository().pipe(Effect.flatMap(module => module.openRead(root, { ...options, runtime, environment: runtime.env })));
      const openWrite: WorkspaceService['openWrite'] = (root, options) => repository().pipe(Effect.flatMap(module => module.openWrite(root, { ...options, runtime, environment: runtime.env })));
      return Workspace.of({ openRead, openWrite, inspectConfiguration: (...args) => Effect.tryPromise(() => import('./config-inspection.ts')).pipe(Effect.flatMap(module => module.inspectConfiguration(...args, runtime)), Effect.mapError(failure)), identify: (input, allowUninitialized, strictFile) => identifyWorkspace(input, allowUninitialized, strictFile, runtime), locate: (input, allowUninitialized) => locateWorkspace(input, allowUninitialized, runtime) });
    }));
  }
  static readonly layer = Workspace.layerWithEnvironment();
}
