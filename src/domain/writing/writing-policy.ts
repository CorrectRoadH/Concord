// @concord-file
// @concord-implements docs/feature/documentation-quality/format.md#writingmd
import { ConcordError, parseWritingPolicy } from '../../model/index.js';
export function readWritingPolicy(source: string, path = 'docs/writing.md') {
  try { return parseWritingPolicy(source, path); }
  catch (cause) { throw new ConcordError('InvalidWritingPolicy', `${path}: ${cause instanceof Error ? cause.message : String(cause)}`); }
}
