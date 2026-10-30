import type { MemoryMeta } from "./shared.js";

export type MemoryDocument = { readonly metadata: MemoryMeta; readonly body: string };
export type StructuredMemoryDocument = MemoryDocument;
