// @concord-file
// @concord-implements docs/engineering/testing/architecture.md#进程内-cli
import { Data, Effect, FileSystem, Stdio, Stream } from "effect";
import { resolve } from 'node:path';
import { applicationRuntime } from '../../app/index.ts';

export class CliInputError extends Data.TaggedError("CliInputError")<{
  readonly path: string;
  readonly message: string;
}> {}
export const readText = Effect.fn('CliInput.readText')(function*(path: string) {
  if (path === "-") {
    const stdio = yield* Stdio.Stdio;
    const chunks = yield* Stream.runCollect(stdio.stdin).pipe(
      Effect.mapError(error => new CliInputError({ path, message: String(error) })),
    );
    return Buffer.concat(chunks).toString('utf8');
  }
  const runtime = yield* applicationRuntime;
  return yield* Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(resolve(runtime.cwd, path))).pipe(
    Effect.mapError((error) => new CliInputError({ path, message: String(error) })),
  );
});
export function readJson(path: string) {
  return readText(path).pipe(Effect.flatMap((source) => Effect.try({
    try: () => JSON.parse(source) as unknown,
    catch: (error) => new CliInputError({
      path,
      message: error instanceof Error ? error.message : String(error),
    }),
  })));
}
