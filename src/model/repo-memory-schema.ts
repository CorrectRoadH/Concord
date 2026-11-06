import type { MemoryMeta } from "./shared.ts";

export type MemoryDocument = { readonly metadata: MemoryMeta; readonly body: string };
export type StructuredMemoryDocument = MemoryDocument;
