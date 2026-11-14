// @concord-file
// @concord-implements docs/feature/documentation-quality/use-case/inspect-writing.md#编辑期间的合并检查
import { Effect } from "effect";
import { ConcordError } from "../../model/index.ts";
import { Argument, Command } from "effect/cli";
import { withQuery } from './cli-repository.ts';
export const check = Command.make('check', { paths: Argument.String('path').pipe(Argument.variadic()) }, args => {
  if (args.paths.length) {
    const paths = args.paths.map(path => /^[\w./-]+$/u.test(path) ? path : `'${path.replaceAll("'", "'\\''")}'`).join(' ');
    return Effect.fail(new ConcordError('InvalidInput', `concord check does not accept paths. Use concord docs check ${paths} to check only writing and terminology in the selected scope.`));
  }
  return withQuery({ name: 'check', input: {} });
}).pipe(Command.withDescription('Validate current document consistency.'));
