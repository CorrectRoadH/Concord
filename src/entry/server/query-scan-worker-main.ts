// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
import { Effect } from 'effect';
import { runReaderMain } from './main.ts';
import { scanQueryProcess } from "../../app/index.ts";
export function run(): void {
  runReaderMain(scanQueryProcess(process.argv[2], process.argv[3]).pipe(Effect.flatMap(message => Effect.sync(() => process.stdout.write(`${JSON.stringify(message)}\n`)))));
}
