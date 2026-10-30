import { Data, Effect, FileSystem } from "effect";

export class CliInputError extends Data.TaggedError("CliInputError")<{
  readonly path: string;
  readonly message: string;
}> {}
export function readText(path: string) {
  if (path === "-") {
    return Effect.callback<string, CliInputError>((resume) => {
      let source = "";
      const onData = (chunk: string | Buffer) => { source += chunk.toString(); };
      const onEnd = () => resume(Effect.succeed(source));
      const onError = (error: Error) => resume(Effect.fail(new CliInputError({ path, message: String(error) })));
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", onData);
      process.stdin.once("end", onEnd);
      process.stdin.once("error", onError);
      return Effect.sync(() => {
        process.stdin.off("data", onData);
        process.stdin.off("end", onEnd);
        process.stdin.off("error", onError);
      });
    });
  }
  return Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(path)).pipe(
    Effect.mapError((error) => new CliInputError({ path, message: String(error) })),
  );
}
export function readJson(path: string) {
  return readText(path).pipe(Effect.flatMap((source) => Effect.try({
    try: () => JSON.parse(source) as unknown,
    catch: (error) => new CliInputError({
      path,
      message: error instanceof Error ? error.message : String(error),
    }),
  })));
}
