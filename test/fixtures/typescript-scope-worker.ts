import { Effect } from 'effect';
import { withTypeScriptSource } from '../../dist/typescript-host.js';

Effect.runSync(Effect.sync(() => withTypeScriptSource('worker.ts', 'export const value = 1;', source => {
  process.stdout.write(`compiler-ready:${source.statements.length}\n`);
  // Hold a real native compiler request scope until its owner stops the group.
  // This deliberately prevents normal lexical disposal.
  const signal = new Int32Array(new SharedArrayBuffer(4));
  while (true) Atomics.wait(signal, 0, 0);
})));
