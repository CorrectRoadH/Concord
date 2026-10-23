import * as Effect from 'effect/Effect';
import { serveEditor } from '../../dist/lsp-server.js';
import { makeOwnedProcessService, type OwnedProcessService } from '../../dist/owned-process.js';

// Only the external process observation is faked; run, cancellation and Scope
// finalizers still use real processes and the production editor implementation.
const program = serveEditor(process.argv[2], () => {
  const service = makeOwnedProcessService();
  const observed: OwnedProcessService = { ...service,
    run: (command, options) => service.run(command, { ...options, stream: {
      ready: (...args) => { process.stderr.write('test-editor-job-started\n'); options.stream?.ready(...args); },
      stdout: chunk => options.stream?.stdout(chunk),
    } }),
    cleanupResults: service.cleanupResults.pipe(Effect.map(results => results.map(result => ({
    ...result, groupCleanup: { ...result.groupCleanup, gone: null, detail: 'injected observation failure' },
  })))) };
  return observed;
});
await Effect.runPromise(program).catch(error => { process.stderr.write(`${String(error)}\n`); process.exitCode = 1; });
