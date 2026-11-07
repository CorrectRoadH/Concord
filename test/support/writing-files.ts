import type { LocalRepository } from './repository.ts';
import { setMarkdown } from '../../src/app/index.ts';
import { renderWritingPolicy, type WritingPolicy } from '../../src/model/index.ts';
/** Test setup uses the same ordinary Markdown save as the Web editor. */
export async function writeWritingFile(repo: LocalRepository, policy: WritingPolicy, expected: string | null, dryRun = false, path = 'docs/writing.md') { const source = renderWritingPolicy(policy); return { ...(await setMarkdown(repo, path, source, expected, dryRun)), source }; }
export async function writeConceptFile(repo: LocalRepository, source: string, expected: string | null, dryRun = false, path = 'docs/concepts.md') { return { ...(await setMarkdown(repo, path, source, expected, dryRun)), source }; }
