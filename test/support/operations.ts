import { Effect } from 'effect';
import { Installation } from '../../src/base/installation/index.js';
import * as application from '../../src/app/index.js';
import * as documents from '../../src/domain/documents/index.js';

/** Fixture composition root: execute real template operations against installed resources. */
const run = <A, E>(operation: Effect.Effect<A, E, Installation>): A => Effect.runSync(operation.pipe(Effect.provide(Installation.layer)));
export const initialize = (...args: Parameters<typeof application.initialize>) => run(application.initialize(...args));
export const createDocument = (...args: Parameters<typeof application.createDocument>) => run(application.createDocument(...args));
export const addPage = (...args: Parameters<typeof documents.addPage>) => run(documents.addPage(...args));
export const templateBody = (...args: Parameters<typeof documents.templateBody>) => run(documents.templateBody(...args));
export const listTemplates = () => run(documents.listTemplates());
