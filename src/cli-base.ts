// @concord-file
// @concord-implements docs/feature/local-sdlc/cli.md#通用约定
import { readFileSync } from 'node:fs';
import { Effect, Option, Schema } from 'effect';
import { Argument, Command, Flag } from 'effect/unstable/cli';
import { ConcordError, decode, failure } from './shared.js';
import { discoverRoot } from './storage.js';
import { humanOutput } from './presentation.js';

const root = Command.make('concord').pipe(Command.withDescription('Connect product contracts, code and test declarations, and engineering memory. Agent guidance: concord --skill [topic].'), Command.withSharedFlags({
  root: Flag.string('root').pipe(Flag.optional, Flag.withDescription('Consumer Git worktree root; otherwise use the Git worktree containing cwd; configuration is optional.')),
  json: Flag.boolean('json').pipe(Flag.withDefault(false)),
  fresh: Flag.boolean('fresh').pipe(Flag.withDefault(false), Flag.withDescription('Wait for current diagnostic sources instead of reading an asynchronously refreshed snapshot.')),
  dryRun: Flag.boolean('dry-run').pipe(Flag.withDefault(false), Flag.withDescription('Validate a document mutation without writing.')),
}));

const text = (name: string) => Flag.string(name);

const optional = (name: string) => text(name).pipe(Flag.optional);

const many = (name: string) => text(name).pipe(Flag.atLeast(0));

const id = Argument.string('id');

function body(path: string): string {
  let source: string;
  try { source = path === '-' ? readFileSync(0, 'utf8') : readFileSync(path, 'utf8'); }
  catch (cause) { throw new ConcordError('InvalidBody', `Cannot read ${path}: ${cause instanceof Error ? cause.message : String(cause)}`); }
  if (Buffer.byteLength(source) > 4 * 1024 * 1024) throw new ConcordError('InvalidBody', 'Author content exceeds 4 MiB');
  return source;
}

function jsonBody<A>(path: string, schema: Schema.ConstraintDecoder<A, never>, label: string): A {
  let value: unknown;
  try { value = JSON.parse(body(path)); }
  catch (cause) { if (cause instanceof ConcordError) throw cause; throw new ConcordError('InvalidJson', `${label} is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`); }
  return decode(schema, value, label);
}

function emit(value: unknown, json: boolean): void {
  const output = json ? JSON.stringify(value) : humanOutput(value);
  if (!json) {
    const diagnostic = Schema.decodeUnknownExit(Schema.Struct({ projection: Schema.Struct({ consistent: Schema.Boolean, builtAt: Schema.String, changedPaths: Schema.Array(Schema.String), lastAttempt: Schema.optional(Schema.Struct({ complete: Schema.Boolean, at: Schema.String })) }) }), { onExcessProperty: 'ignore' })(value);
    if (diagnostic._tag === 'Success') {
      const projection = diagnostic.value.projection;
      if (!projection.consistent) process.stdout.write(`历史投影，构建期间来源变化（${projection.changedPaths.length} 个路径），关系可能不完整；使用 --fresh 获取当前结果。\n`);
      else if (projection.lastAttempt?.complete === false) process.stdout.write(`一致结果构建于 ${projection.builtAt}，此后的刷新在编辑中未能取得一致结果（最近 ${projection.lastAttempt.at}）。\n`);
    }
  }
  process.stdout.write(output.endsWith('\n') ? output : `${output}\n`);
}

const sync = <A>(fn: () => A) => Effect.try({ try: fn, catch: failure });

const cached = (dry: boolean) => dry ? 'off' as const : 'use' as const;

const viewRoot = (settings: { readonly root: Option.Option<string> }): string => discoverRoot(Option.getOrUndefined(settings.root));

const expected = (value: string): string | null => value === 'null' ? null : value;

export { root, text, optional, many, id, body, jsonBody, emit, sync, cached, viewRoot, expected };
