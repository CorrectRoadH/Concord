// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md#edit
import { Argument, Command } from 'effect/unstable/cli';
import { setAuthor } from './documents.js';
import { text, body, sync, expected } from './cli-base.js';
import { withRepo } from './cli-repository.js';

const author = Command.make('author').pipe(Command.withDescription('Edit author prose while retaining managed metadata and history.'), Command.withSubcommands([
  Command.make('set', { ref: Argument.string('reference'), body: text('body'), expectedDigest: text('expected-digest') }, args => withRepo((repo,s) => sync(() => setAuthor(repo, args.ref, body(args.body), args.expectedDigest, s.dryRun)))),
]));

export { author };
