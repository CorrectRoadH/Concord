import { renderDocument } from "../../src/model/index.js";
import { DocumentSchema, decode } from "../../src/model/index.js";

/** Fixtures use the format owner's renderer, including strict metadata validation. */
export function renderOwnerFixture(fields: { readonly kind: string; readonly [key: string]: unknown }, body?: string): string {
  const metadata = decode(DocumentSchema, { format: 'concord.document/v1', ...fields }, 'owner fixture');
  return renderDocument(metadata, body ?? `# ${metadata.title}\n`);
}
