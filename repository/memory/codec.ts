import { stringify } from "yaml";
import { type MemoryMeta } from "concord-sdlc/model";
import { MemoryContentInvalid } from "./errors.js";
import type { MemoryDocument } from "./schema.js";
import { decodeDocumentSource } from 'concord-sdlc/document-codec';

export function decodeMemoryDocument(path: string, _id: string, source: string): MemoryDocument {
  try {
    const record = decodeDocumentSource(path, source);
    if (record?.metadata.kind !== 'memory') throw new Error('missing concord.document/v1 Memory frontmatter');
    return { metadata: record.metadata, body: record.body };
  } catch (cause) {
    throw new MemoryContentInvalid({ operation: "decode", path, message: cause instanceof Error ? cause.message : String(cause) });
  }
}

export function encodeMemoryDocument(metadata: MemoryMeta, body: string): string {
  return `---\n${stringify(metadata, { lineWidth: 0, aliasDuplicateObjects: false }).trimEnd()}\n---\n${body}`;
}
