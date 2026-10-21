import { Effect } from 'effect';
import { serveEditor } from '../../dist/lsp-server.js';
import { makeOwnedProcessService } from '../../dist/owned-process.js';

// Only the external process observation is faked; run, cancellation and Scope
// finalizers still use real processes and the production editor implementation.
const program = serveEditor(process.argv[2], () => {
  const service = makeOwnedProcessService();
  return { ...service, cleanupResults: service.cleanupResults.pipe(Effect.map(results => results.map(result => ({
    ...result, groupCleanup: { ...result.groupCleanup, gone: null, detail: 'injected observation failure' },
  })))) };
});
await Effect.runPromise(program).catch(error => { process.stderr.write(`${String(error)}\n`); process.exitCode = 1; });
