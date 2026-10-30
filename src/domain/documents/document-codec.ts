// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#操作依赖
import type { DocumentRecord } from "../../model/index.js";


import { documentProjection, projectionRecord } from "./document-projection.js";

/** Strict owner decoding, reusing only projections bound to the current bytes. */
export function decodeDocumentSource(path: string, source: string): DocumentRecord | undefined {
  return projectionRecord(path, documentProjection(path, source));
}
