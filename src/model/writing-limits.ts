// @concord-file
// @concord-implements docs/feature/documentation-quality/format.md
import { ConcordError } from './shared.js';
export const WRITING_PARSER_VERSION = 'writing-md-v1/concepts-prose-v2';
export interface PolicySource { path: string; pointer?: string; line?: number }
export function writingBudget(message: string): never { throw new ConcordError('WritingBudgetExceeded', message, { complete: false }); }
