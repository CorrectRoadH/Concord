// @concord-file
// @concord-implements docs/feature/documentation-quality/use-case/inspect-writing.md#编辑期间的聚合检查
import { Command } from "effect/unstable/cli";
import { withQuery } from './cli-repository.js';
export const check = Command.make('check', {}, () => withQuery({ name: 'check', input: {} })).pipe(Command.withDescription('Validate current document consistency.'));
