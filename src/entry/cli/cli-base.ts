// @concord-file
// @concord-implements docs/feature/local-sdlc/cli.md#通用约定
// @concord-implements docs/engineering/testing/architecture.md#进程内-cli
import { Effect, Option, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { ConcordError, decode, failure } from "../../model/index.ts";
import { locateProjectRoot } from "../../app/index.ts";
import { humanOutput } from "./presentation.ts";
import { readText } from './input.ts';
import { writeStdout } from './invocation.ts';

const root = Command.make('concord').pipe(Command.withDescription('Connect product contracts, code and test declarations, and engineering memory. Agent guidance: concord --skill [topic].'), Command.withSharedFlags({
  root: Flag.String('root').pipe(Flag.optional, Flag.withDescription('Consumer Git worktree root; otherwise use the Git worktree containing cwd; configuration is optional.')),
  json: Flag.Boolean('json').pipe(Flag.withDefault(false)),
  server: Flag.Literals('server', ['shared', 'command', 'existing']).pipe(Flag.withDefault('shared'), Flag.withDescription('Use a shared service, a command-owned service, or only an existing service.')),
  fresh: Flag.Boolean('fresh').pipe(Flag.withDefault(false), Flag.withDescription('Wait for current diagnostic sources instead of reading an asynchronously refreshed snapshot.')),
  dryRun: Flag.Boolean('dry-run').pipe(Flag.withDefault(false), Flag.withDescription('Validate a document mutation without writing.')),
}));

const text = (name: string) => Flag.String(name);

const optional = (name: string) => text(name).pipe(Flag.optional);

const many = (name: string) => text(name).pipe(Flag.atLeast(0));

const id = Argument.String('id');

const body = Effect.fn('CliInput.body')(function*(path: string) {
  const source = yield* readText(path).pipe(Effect.mapError(cause => new ConcordError('InvalidBody', `Cannot read ${path}: ${cause.message}`)));
  if (Buffer.byteLength(source) > 4 * 1024 * 1024) return yield* Effect.fail(new ConcordError('InvalidBody', 'Author content exceeds 4 MiB'));
  return source;
});

const jsonBody = Effect.fn('CliInput.jsonBody')(function*<A>(path: string, schema: Schema.ConstraintDecoder<A, never>, label: string) {
  const source = yield* body(path);
  const value = yield* Effect.try({
    try: () => JSON.parse(source) as unknown,
    catch: cause => new ConcordError('InvalidJson', `${label} is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`),
  });
  return yield* sync(() => decode(schema, value, label));
});

const emit = Effect.fn('CliOutput.emit')(function*(value: unknown, json: boolean) {
  const output = json ? JSON.stringify(value) : humanOutput(value);
  if (!json) {
    const diagnostic = Schema.decodeUnknownExit(Schema.Struct({ projection: Schema.Struct({ consistent: Schema.Boolean, builtAt: Schema.String, changedPaths: Schema.Array(Schema.String), lastAttempt: Schema.optional(Schema.Struct({ complete: Schema.Boolean, at: Schema.String })) }) }), { onExcessProperty: 'ignore' })(value);
    if (diagnostic._tag === 'Success') {
      const projection = diagnostic.value.projection;
      if (!projection.consistent) yield* writeStdout(`历史投影，构建期间来源变化（${projection.changedPaths.length} 个路径），关系可能不完整；使用 --fresh 获取当前结果。\n`);
      else if (projection.lastAttempt?.complete === false) yield* writeStdout(`一致结果构建于 ${projection.builtAt}，此后的刷新在编辑中未能取得一致结果（最近 ${projection.lastAttempt.at}）。\n`);
    }
  }
  yield* writeStdout(output.endsWith('\n') ? output : `${output}\n`);
});

const sync = <A>(fn: () => A | Promise<A>) => Effect.tryPromise({ try: async () => await fn(), catch: failure }).pipe(Effect.uninterruptible);

const cached = (dry: boolean) => dry ? 'off' as const : 'use' as const;

const viewRoot = (settings: { readonly root: Option.Option<string> }) => locateProjectRoot(Option.getOrUndefined(settings.root));

const expected = (value: string): string | null => value === 'null' ? null : value;

export { root, text, optional, many, id, body, jsonBody, emit, sync, cached, viewRoot, expected };
