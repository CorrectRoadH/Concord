import { ConcordError, DocumentSchema, decode, type DocumentMeta } from "./shared.ts";
import { renderOwnerFrontmatter } from "./owner-frontmatter.ts";
import { documentTitle } from "./document-source.ts";
export function renderDocument(metadata: DocumentMeta, body: string): string {
  const valid = decode(DocumentSchema, metadata, `${metadata.kind}:${metadata.id}`);
  if (!body.trim() || /^(?:\uFEFF)?---(?:\r?\n|$)/u.test(body)) throw new ConcordError('InvalidAuthorBody', 'Expected Markdown without frontmatter');
  let content = body.endsWith('\n') ? body : `${body}\n`;
  try { documentTitle(metadata.id, content); }
  catch { content = `# ${valid.title}\n\n${content}`; documentTitle(metadata.id, content); }
  return `${renderOwnerFrontmatter(valid)}${content}`;
}
