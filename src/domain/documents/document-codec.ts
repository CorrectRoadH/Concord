// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#操作依赖
import type { DocumentRecord } from "../../model/index.ts";
import type { RuntimeEnvironmentSnapshot } from '../../base/environment/index.ts';


import { documentProjection, projectionRecord, type makeDocumentProjectionCache } from "./document-projection.ts";

/** Strict owner decoding, reusing only projections bound to the current bytes. */
export function decodeDocumentSource(path: string, source: string, runtime: RuntimeEnvironmentSnapshot, contentCache?: ReturnType<typeof makeDocumentProjectionCache>): DocumentRecord | undefined {
  return projectionRecord(path, documentProjection(path, source, runtime, contentCache));
}
