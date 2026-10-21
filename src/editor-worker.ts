// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/use-editor-service.md
import { parentPort, workerData } from 'node:worker_threads';
import { Effect } from 'effect';
import { Job } from './editor-protocol.js';
import { computeEditor } from './editor-compute.js';
import { decode, failure } from './shared.js';

// No listener survives a task. Terminating this isolate also ends all parser caches.
const program = Effect.try({ try: () => decode(Job, workerData, 'editor job'), catch: failure }).pipe(
  Effect.flatMap(computeEditor),
  Effect.match({ onSuccess: result => ({ ok: true as const, result }), onFailure: error => ({ ok: false as const, code: error.code, message: error.message }) }),
  Effect.flatMap(reply => Effect.sync(() => parentPort?.postMessage(reply))),
);
await Effect.runPromise(program);
