import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { failure } from '../../model/index.js';
import { assertLeasePath, CoordinationError } from './file-lease.js';

/** Read-only journal inspection does not grant publication ownership. */
export const inspectPendingJournals = Effect.fn('Publication.inspectPendingJournals')((privateDir: string, verifyPaths = true) => Effect.try({
  try: () => ['journal.json', 'trace/publication-journal.json', 'trace/multi-file-publication-journal.json']
    .map(relative => join(privateDir, relative)).filter(path => { if (verifyPaths) assertLeasePath(path); return lstatSync(path, { throwIfNoEntry: false }) !== undefined; }),
  catch: cause => cause instanceof CoordinationError ? cause : failure(cause),
}));
