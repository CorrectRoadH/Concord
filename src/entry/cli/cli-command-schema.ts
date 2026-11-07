// @concord-file
// @concord-implements docs/feature/local-sdlc/cli.md#机器可读-schema
import { Effect, Option } from 'effect';
import { Argument, Command } from 'effect/cli';
import { machineSchema, machineSchemaNames } from '../../model/index.ts';
import { emit, root, sync } from './cli-base.ts';

export const schema = Command.make('schema', { name: Argument.String('name').pipe(Argument.optional) }, args => Effect.gen(function*() {
  const settings = yield* root;
  const name = Option.getOrUndefined(args.name);
  const result = name !== undefined ? yield* sync(() => machineSchema(name)) : { available: machineSchemaNames };
  yield* emit(result, Option.isSome(args.name) || settings.json);
})).pipe(Command.withDescription('Print a machine-readable JSON Schema without opening a project.'));
