import { ConcordError, DocumentSchema, decode, type DocumentMeta } from "./shared.js";
import { renderOwnerFrontmatter } from "./owner-frontmatter.js";
import { documentTitle, renderResearchSources } from "./document-source.js";
export function renderDocument(metadata: DocumentMeta, body: string): string {
  const valid = decode(DocumentSchema, metadata, `${metadata.kind}:${metadata.id}`);
  if (!body.trim() || /^(?:\uFEFF)?---(?:\r?\n|$)/u.test(body)) throw new ConcordError('InvalidAuthorBody', 'Expected Markdown without frontmatter');
  let content = body.endsWith('\n') ? body : `${body}\n`;
  try { documentTitle(metadata.id, content); }
  catch { content = `# ${valid.title}\n\n${content}`; documentTitle(metadata.id, content); }
  if (valid.kind === 'research' && !/^## (?:Sources|来源)\s*$/mu.test(content)) content += renderResearchSources(valid.observedAt, valid.sources);
  return `${renderOwnerFrontmatter(valid)}${content}`;
}
