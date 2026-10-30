import type { MemoryMeta } from "concord-sdlc/model";
export type { MemoryMeta } from "concord-sdlc/model";
export type MemoryDocument = { readonly metadata: MemoryMeta; readonly body: string };
export type StructuredMemoryDocument = MemoryDocument;
