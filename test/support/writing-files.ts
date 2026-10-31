import type { LocalRepository } from './repository.js';
import { setMarkdown } from '../../src/app/index.js';
import { renderWritingPolicy, type WritingPolicy } from '../../src/model/index.js';
/** Test setup uses the same ordinary Markdown save as the Web editor. */
export function writeWritingFile(repo: LocalRepository, policy: WritingPolicy, expected: string | null, dryRun = false, path = 'docs/writing.md') { const source = renderWritingPolicy(policy); return { ...setMarkdown(repo, path, source, expected, dryRun), source }; }
export function writeConceptFile(repo: LocalRepository, source: string, expected: string | null, dryRun = false, path = 'docs/concepts.md') { return { ...setMarkdown(repo, path, source, expected, dryRun), source }; }
