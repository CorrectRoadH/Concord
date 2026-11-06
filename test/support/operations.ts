import { PersistentCache } from '../../src/base/cache/index.ts';
import { Effect } from 'effect';
import { Installation } from '../../src/base/installation/index.ts';
import * as application from '../../src/app/index.ts';
import * as documents from '../../src/domain/documents/index.ts';

/** Fixture composition root: execute real template operations against installed resources. */
const run = <A, E>(operation: Effect.Effect<A, E, Installation>): A => Effect.runSync(operation.pipe(Effect.provide(Installation.layer)));
export const initialize = (...args: Parameters<typeof application.initialize>) => run(application.initialize(...args));
export const createDocument = (...args: Parameters<typeof application.createDocument>) => run(application.createDocument(...args));
export const addPage = (...args: Parameters<typeof documents.addPage>) => run(documents.addPage(...args));
export const templateBody = (...args: Parameters<typeof documents.templateBody>) => run(documents.templateBody(...args));
export const listTemplates = () => run(documents.listTemplates());

const runCache = <A, E>(operation: Effect.Effect<A, E, import('../../src/base/cache/index.ts').PersistentCache>): A => Effect.runSync(operation.pipe(Effect.provide(PersistentCache.layer)));
export const readQuery = (...args: Parameters<typeof application.readQuery>) => runCache(application.readQuery(...args));
export const storeQuery = (...args: Parameters<typeof application.storeQuery>) => runCache(application.storeQuery(...args));
export const readWorkspaceProjection = (...args: Parameters<typeof application.readWorkspaceProjection>) => runCache(application.readWorkspaceProjection(...args));
export const storeWorkspaceProjection = (...args: Parameters<typeof application.storeWorkspaceProjection>) => runCache(application.storeWorkspaceProjection(...args));
