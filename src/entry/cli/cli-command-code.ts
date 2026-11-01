// @concord-file
// @concord-implements docs/feature/local-sdlc/cli.md#关联源码
// @concord-implements docs/feature/local-sdlc/cli.md#依赖分析
import { Effect, Schema } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { ConcordError } from "../../model/index.js";
import { analyzeCode } from "../../app/index.js";
import { codeSnippet, listCode, locateCode } from "../../app/index.js";
import { many, sync } from "./cli-base.js";
import { withRepo, withReadRepo, withQuery } from "./cli-repository.js";

const code = Command.make('code').pipe(Command.withDescription('Associate files, functions and statement regions with Feature, Use Case or Engineering contracts. No coverage or completion claim.'), Command.withSubcommands([
  Command.make('analyze', {}, () => withRepo((repo, settings) => settings.dryRun ? Effect.fail(new ConcordError('InvalidOption', 'code analyze does not accept --dry-run')) : analyzeCode(repo), { unlocked: true, cacheRequired: true })).pipe(Command.withDescription('Explicitly analyze dependencies and run configured language servers; writes disposable observations only.')),
  Command.make('list', {}, () => withQuery({ name: 'code.list', input: {} })).pipe(Command.withDescription('List current declarations from configured sourceRoots.')),
  Command.make('at', { location: Argument.string('path:line').pipe(Argument.withSchema(Schema.String.check(Schema.isPattern(/^.+:[0-9]+$/u))), Argument.withDescription('Repository-relative source path and 1-based line; returns every containing scope.')) }, args => withReadRepo(repo => {
    const separator = args.location.lastIndexOf(':');
    return sync(() => locateCode(repo, args.location.slice(0, separator), Number(args.location.slice(separator + 1))));
  })).pipe(Command.withDescription('Find all explicit declarations containing a repository-relative source line.')),
  Command.make('marker', { scope: Flag.choice('scope', ['file', 'node', 'region']), contract: many('contract') }, args => withReadRepo(repo => sync(() => codeSnippet(repo, args.scope, args.contract)))).pipe(Command.withDescription('Print validated source comments; repeat --contract for multiple targets. Does not edit source.')),
]));

export { code };
