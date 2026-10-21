// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/use-editor-service.md
import { Effect } from 'effect';
import { Job, editorLimits } from './editor-protocol.js';
import { computeEditor } from './editor-compute.js';
import { ConcordError, decode, failure } from './shared.js';

// One bounded request per process; the parent owns this process and its compiler group.
const program = Effect.tryPromise({ try: async () => {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > editorLimits.input) throw new ConcordError('EditorBudgetExceeded', 'Job input limit');
    chunks.push(buffer);
  }
  return decode(Job, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))), 'editor job');
}, catch: failure }).pipe(
  Effect.flatMap(computeEditor),
  Effect.match({ onSuccess: result => ({ ok: true as const, result }), onFailure: error => ({ ok: false as const, code: error.code, message: error.message }) }),
  Effect.flatMap(reply => Effect.sync(() => process.stdout.write(JSON.stringify(reply)))),
);
await Effect.runPromise(program);
