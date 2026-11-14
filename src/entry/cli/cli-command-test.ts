// @concord-file
// @concord-implements docs/feature/local-sdlc/cli.md#测试关联与-issue-关闭
// @concord-implements docs/feature/local-sdlc/cli.md#原生测试-adapter
import { Effect } from "effect";
import { Argument, Command } from "effect/cli";
import { collectNativeTests } from "../../domain/tests/index.ts";
import { annotationSnippet } from "../../domain/onboarding/index.ts";
import { ConcordError } from "../../model/index.ts";
import { text, many, id, sync } from "./cli-base.ts";
import { withRepo, withReadRepo, withQuery } from "./cli-repository.ts";

const test = Command.make('test').pipe(Command.withDescription('Collect native test identities and inspect source annotations.'), Command.withSubcommands([
  Command.make('marker', { contract: text('contract'), issue: many('issue') }, args => withReadRepo(repo => sync(() => annotationSnippet(repo, args.contract, args.issue)))).pipe(Command.withDescription('Print @feature or @use-case markers for a test file. Does not edit or run tests.')),
  Command.make('list', {}, () => withQuery({ name: 'test.list', input: {} })),
  Command.make('show', { id }, args => withQuery({ name: 'test.show', input: { id: args.id } })),
  Command.make('discover', { files: Argument.String('file').pipe(Argument.variadic()) }, args => withRepo((repo,s) => s.dryRun ? Effect.fail(new ConcordError('InvalidOption','test discover does not accept --dry-run')) : collectNativeTests(repo,args.files), { unlocked:true, cacheRequired:true })).pipe(Command.withDescription('Run configured native test adapters and save disposable discovery observations.')),
]));

export { test };
