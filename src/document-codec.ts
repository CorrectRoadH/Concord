// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#操作依赖
import { ConcordError, DocumentSchema, decode, type DocumentMeta, type DocumentRecord } from './shared.js';
import { renderOwnerFrontmatter } from './owner-frontmatter.js';
import { documentTitle, renderResearchSources } from './document-source.js';
import { documentProjection, projectionRecord } from './document-projection.js';

/** Strict owner decoding, reusing only projections bound to the current bytes. */
export function decodeDocumentSource(path: string, source: string): DocumentRecord | undefined {
  return projectionRecord(path, documentProjection(path, source));
}

export function renderDocument(metadata: DocumentMeta, body: string): string {
  const valid = decode(DocumentSchema, metadata, `${metadata.kind}:${metadata.id}`);
  if (!body.trim() || /^(?:\uFEFF)?---(?:\r?\n|$)/u.test(body)) throw new ConcordError('InvalidAuthorBody', 'Expected Markdown without frontmatter');
  let content = body.endsWith('\n') ? body : `${body}\n`;
  try { documentTitle(metadata.id, content); }
  catch { content = `# ${valid.title}\n\n${content}`; documentTitle(metadata.id, content); }
  if (valid.kind === 'research' && !/^## (?:Sources|来源)\s*$/mu.test(content)) content += renderResearchSources(valid.observedAt, valid.sources);
  return `${renderOwnerFrontmatter(valid)}${content}`;
}
export { documentTitle, researchSources, renderResearchSources } from './document-source.js';
export { deriveDesignRecord, designState, writeDesignDeclaration } from './design-state.js';
export { IssueFrontmatterSchema, MemoryFrontmatterSchema } from './owner-frontmatter.js';
