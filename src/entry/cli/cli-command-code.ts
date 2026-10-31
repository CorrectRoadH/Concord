// @concord-file
// @concord-implements docs/feature/local-sdlc/cli.md#关联源码
// @concord-implements docs/feature/local-sdlc/cli.md#依赖分析
import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { ConcordError } from "../../model/index.js";
import { analyzeCode } from "../../app/index.js";
import { codeSnippet, listCode, locateCode } from "../../app/index.js";
import { many, sync } from "./cli-base.js";
import { withRepo, withReadRepo, withQuery } from "./cli-repository.js";

const code = Command.make('code').pipe(Command.withDescription('Associate files, functions and statement regions with Feature, Use Case or Engineering contracts. No coverage or completion claim.'), Command.withSubcommands([
  Command.make('analyze', {}, () => withRepo((repo, settings) => settings.dryRun ? Effect.fail(new ConcordError('InvalidOption', 'code analyze does not accept --dry-run')) : analyzeCode(repo), { unlocked: true })).pipe(Command.withDescription('Explicitly analyze dependencies and run configured language servers; writes disposable observations only.')),
  Command.make('list', {}, () => withQuery({ name: 'code.list', input: {} })).pipe(Command.withDescription('List current declarations from configured sourceRoots.')),
  Command.make('locate', { file: Argument.string('path'), line: Flag.integer('line').pipe(Flag.withDescription('1-based source line; returns every containing scope.')) }, args => withReadRepo(repo => sync(() => locateCode(repo, args.file, args.line)))).pipe(Command.withDescription('Find all explicit declarations containing a repository-relative source line.')),
  Command.make('annotate', { scope: Flag.choice('scope', ['file', 'node', 'region']), contract: many('contract') }, args => withReadRepo(repo => sync(() => codeSnippet(repo, args.scope, args.contract)))).pipe(Command.withDescription('Print validated source comments; repeat --contract for multiple targets. Does not edit source.')),
]));

export { code };
