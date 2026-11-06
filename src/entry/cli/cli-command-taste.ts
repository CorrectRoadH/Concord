// @concord-file
// @concord-implements docs/feature/taste/use-case/cite-taste.md
import { Command } from "effect/unstable/cli";
import { withQuery } from './cli-repository.ts';
export const taste = Command.make('taste', {}, () => withQuery({ name: 'taste', input: {} })).pipe(Command.withDescription('List project taste entries and the pages citing them.'));
