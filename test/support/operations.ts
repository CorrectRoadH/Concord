import { RuntimeEnvironment, makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import type * as CacheTypes from '../../src/base/cache/index.ts';
import { PersistentCache } from '../../src/base/cache/index.ts';
import { Effect } from 'effect';
import { Installation } from '../../src/base/installation/index.ts';
import * as application from '../../src/app/index.ts';
import * as documents from '../../src/domain/documents/index.ts';

/** Fixture composition root: execute real template operations against installed resources. */
const run = <A, E>(operation: Effect.Effect<A, E, Installation | RuntimeEnvironment>): Promise<A> => Effect.runPromise(operation.pipe(Effect.provide(Installation.layer), Effect.provide(RuntimeEnvironment.layer(makeRuntimeEnvironment(process.cwd(), process.env)))));
export const initialize = async (...args: Parameters<typeof application.initialize>) => run(application.initialize(...args));
export const createDocument = async (...args: Parameters<typeof application.createDocument>) => run(application.createDocument(...args));
export const addPage = async (...args: Parameters<typeof documents.addPage>) => run(documents.addPage(...args));
export const templateBody = async (...args: Parameters<typeof documents.templateBody>) => run(documents.templateBody(...args));
export const listTemplates = async () => run(documents.listTemplates());

const runCache = <A, E>(operation: Effect.Effect<A, E, CacheTypes.PersistentCache | RuntimeEnvironment>): A => Effect.runSync(operation.pipe(Effect.provide(PersistentCache.layer), Effect.provide(RuntimeEnvironment.layer(makeRuntimeEnvironment(process.cwd(), process.env)))));
export const readQuery = (...args: Parameters<typeof application.readQuery>) => runCache(application.readQuery(...args));
export const storeQuery = (...args: Parameters<typeof application.storeQuery>) => runCache(application.storeQuery(...args));
export const readWorkspaceProjection = (...args: Parameters<typeof application.readWorkspaceProjection>) => runCache(application.readWorkspaceProjection(...args));
export const storeWorkspaceProjection = (...args: Parameters<typeof application.storeWorkspaceProjection>) => runCache(application.storeWorkspaceProjection(...args));
