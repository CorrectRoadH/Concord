import * as Effect from 'effect/Effect';
import { NodeServices } from '@effect/platform-node';
import { RuntimeEnvironment, makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { serveEditor } from "../../src/entry/lsp/index.ts";
import { makeOwnedProcessService, type OwnedProcessService } from "../../src/base/process/index.ts";

// Only the external process observation is faked; run, cancellation and Scope
// finalizers still use real processes and the production editor implementation.
const runtime = makeRuntimeEnvironment(process.cwd(), process.env);
const program = serveEditor(process.argv[2], () => {
  const service = makeOwnedProcessService({ environment: runtime });
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
await Effect.runPromise(program.pipe(Effect.provide(NodeServices.layer), Effect.provideService(RuntimeEnvironment, runtime))).then(code => { process.exitCode = code; }).catch(error => { process.stderr.write(`${String(error)}\n`); process.exitCode = 1; });
