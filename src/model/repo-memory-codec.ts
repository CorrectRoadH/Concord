import type { MemoryMeta } from "./shared.js";
import { MemoryContentInvalid } from "./repo-memory-errors.js";
import type { MemoryDocument } from "./repo-memory-schema.js";
import { decodeUncachedDocumentSource as decodeDocumentSource } from "./document-source.js";
import { renderDocument } from "./document-render.js";

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
  return renderDocument(metadata, body);
}
