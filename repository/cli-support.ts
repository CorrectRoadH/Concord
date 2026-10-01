import { Cause, Console, Data, Effect, Exit, FileSystem } from "effect";
import { CliError, Command, Flag as Options } from "effect/unstable/cli";
import type { TerminalDelivery, TerminalDeliverySink } from "./docs/contribution.js";
class CliInputError extends Data.TaggedError("CliInputError")<{
  readonly path: string;
  readonly message: string;
}> {}

export const jsonOption = Options.boolean("json").pipe(
  Options.withDefault(false),
  Options.withDescription("Emit the complete structured outcome as JSON."),
);
export const dryRunOption = Options.boolean("dry-run").pipe(
  Options.withDefault(false),
  Options.withDescription("Validate and return the planned outcome without writing."),
);

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

export function deliverTerminal(delivery: TerminalDelivery) {
  return Effect.sync(() => {
    if (delivery.stdout !== "") process.stdout.write(delivery.stdout);
    if (delivery.stderr !== "") process.stderr.write(delivery.stderr);
    if (delivery.exitCode !== 0) process.exitCode = delivery.exitCode;
  });
}

function resultOk(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return true;
  const record = value as Record<string, unknown>;
  if (typeof record.ok === "boolean") return record.ok;
  return record.receipt === undefined ? true : resultOk(record.receipt);
}

export function emit(
  value: unknown,
  json: boolean,
  rendered?: string,
  exitCode = resultOk(value) ? 0 : 1,
  deliver: TerminalDeliverySink = deliverTerminal,
) {
  const record = typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined;
  const human = typeof record?.summary === "string"
    ? `${record.summary}\n`
    : `${JSON.stringify(value, null, 2)}\n`;
  const output = json ? `${JSON.stringify(value, null, 2)}\n` : rendered ?? human;
  const warnings = !json && record?.complete === false && Array.isArray(record.findings ?? record.incomplete) ? ((record.findings ?? record.incomplete) as readonly import("./docs/trace/model.js").TraceFinding[]).map(f => `warning: ${f.path}: ${f.message}\n`).join("") : "";
  return deliver({ stdout: output, stderr: warnings, exitCode });
}

/** Only declared repository failures may contribute messages or structured details. */
export interface RepositoryFailure {
  readonly ok: false;
  readonly error: string;
  readonly message: string;
  readonly details?: unknown;
}
export function repositoryFailure(error: unknown): RepositoryFailure {
  if (typeof error !== "object" || error === null) return { ok: false, error: "RepositoryToolError", message: "Repository command failed" };
  const record = error as Record<string, unknown>;
  const code = typeof record._tag === "string" ? record._tag : typeof record.code === "string" ? record.code : "RepositoryToolError";
  if (code === "RepositoryToolError" || (typeof record._tag !== "string" && !(error instanceof Error && error.name === "CaseCliError"))) return { ok: false, error: "RepositoryToolError", message: "Repository command failed" };
  const message = typeof record.detail === "string" ? record.detail : typeof record.message === "string" && record.message !== "" ? record.message : code;
  const fields = Object.fromEntries(["findings", "selector", "path", "subject", "candidates"].filter(key => record[key] !== undefined).map(key => [key, record[key]]));
  const details = record.details ?? (Object.keys(fields).length === 0 ? undefined : fields);
  return { ok: false, error: code, message, ...(details === undefined ? {} : { details }) };
}
export function renderUnhandledError(error: unknown): string {
  const failure = repositoryFailure(error);
  return `${failure.error}: ${failure.message}`;
}
export function renderRepositoryFailure(error: unknown, json: boolean): string {
  return json ? `${JSON.stringify(repositoryFailure(error))}\n` : `${renderUnhandledError(error).replace(/\s*\n\s*/gu, " ")}\n`;
}

/** Run a composed tree while owning parse-error output, including implicit help. */
export function runComposedCli<C extends Command.Command<any, any, any, any, any>>(
  command: C,
  config: { readonly version: string },
) {
  return Effect.gen(function*() {
    const original = yield* Console.Console;
    const logs: unknown[][] = [];
    const json = process.argv.slice(2).includes("--json");
    const result = yield* Effect.exit((Command.run(command, { ...config, renderErrors: false }) as Effect.Effect<void, Command.Error<C> | CliError.CliError, Command.Services<C> | Command.Environment>).pipe(
      Effect.provideService(Console.Console, { ...original, log: (...args) => { logs.push([...args]); } }),
    ));
    if (Exit.isSuccess(result)) {
      for (const args of logs) yield* Effect.sync(() => original.log(...args));
      return;
    }
    const error = Cause.squash(result.cause);
    if (CliError.isCliError(error)) {
      if (error._tag === "ShowHelp" && error.errors.length === 0) {
        for (const args of logs) yield* Effect.sync(() => original.log(...args));
        return;
      }
      const first = error._tag === "ShowHelp" ? error.errors[0]! : error;
      const parent = (first._tag === "UnknownSubcommand" ? first.parent ?? (error._tag === "ShowHelp" ? error.commandPath : []) : error._tag === "ShowHelp" ? error.commandPath : []).join(" ");
      const failure: RepositoryFailure = first._tag === "UnknownSubcommand"
        ? { ok: false, error: "UnknownSubcommand", message: `${JSON.stringify(first.subcommand)} for ${JSON.stringify(parent)}; run ${parent} --help`, details: { name: first.subcommand, parent } }
        : { ok: false, error: "InvalidInput", message: first.message.replace(/\s*\n\s*/gu, " ") };
      yield* deliverTerminal({ stdout: "", stderr: json ? `${JSON.stringify(failure)}\n` : `${failure.error}: ${failure.message}\n`, exitCode: 1 });
      return;
    }
    yield* deliverTerminal({ stdout: "", stderr: renderRepositoryFailure(error, json), exitCode: 1 });
  });
}
