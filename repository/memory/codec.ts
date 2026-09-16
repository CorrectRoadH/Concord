import { parse, stringify } from "yaml";
import { decode, MemorySchema, type MemoryMeta } from "concord-sdlc/model";
import { MemoryContentInvalid } from "./errors.js";
import type { MemoryDocument } from "./schema.js";

export function decodeMemoryDocument(path: string, id: string, source: string): MemoryDocument {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(source);
  if (match?.[1] === undefined || match[2] === undefined) throw new MemoryContentInvalid({ operation: "decode", path, message: "missing concord.document/v1 frontmatter" });
  let input: unknown;
  try { input = parse(match[1]) as unknown; }
  catch (cause) { throw new MemoryContentInvalid({ operation: "decode", path, message: cause instanceof Error ? cause.message : String(cause) }); }
  try {
    const metadata = decode(MemorySchema, input, path) as MemoryMeta;
    if (metadata.id !== id) throw new Error("filename and metadata IDs disagree");
    return { metadata, body: match[2] };
  } catch (cause) {
    throw new MemoryContentInvalid({ operation: "decode", path, message: cause instanceof Error ? cause.message : String(cause) });
  }
}

export function encodeMemoryDocument(metadata: MemoryMeta, body: string): string {
  return `---\n${stringify(metadata, { lineWidth: 0 }).trimEnd()}\n---\n${body}`;
}
