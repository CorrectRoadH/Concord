import { documentMarkdownProjection, projectionRecord, projectionTree, type makeDocumentProjectionCache } from "./document-projection.ts";
import type { RuntimeEnvironmentSnapshot } from '../../base/environment/index.ts';
import { inspectTreeSteps } from "../../model/index.ts";
import { ConcordError, type Finding } from "../../model/index.ts";
import type { UseCaseStep, RootOrderedList, StepMarkerRange } from "../../model/index.ts";
export function headingAnchors(source: string, path = 'document.md', runtime: RuntimeEnvironmentSnapshot, contentCache?: ReturnType<typeof makeDocumentProjectionCache>): ReadonlySet<string> {
  return new Set(documentMarkdownProjection(path, source, runtime, contentCache).anchors);
}
export function inspectSteps(path: string, source: string, runtime: RuntimeEnvironmentSnapshot, contentCache?: ReturnType<typeof makeDocumentProjectionCache>) {
  try {
    const projection = documentMarkdownProjection(path, source, runtime, contentCache);
    const owner = projectionRecord(path, projection);
    return { ...projection.steps, get items() {
      return inspectTreeSteps(path, source, owner?.metadata.kind === 'use-case', projectionTree(source, projection)).items;
    } };
  } catch (cause) {
    return { steps: [], lists: [], markers: [], items: [], findings: [{ code: cause instanceof ConcordError ? cause.code : 'InvalidSteps', path, message: cause instanceof Error ? cause.message : String(cause) }] as Finding[] };
  }
}
export function extractSteps(path: string, source: string, runtime: RuntimeEnvironmentSnapshot, contentCache?: ReturnType<typeof makeDocumentProjectionCache>): { readonly steps: readonly UseCaseStep[]; readonly lists: readonly RootOrderedList[]; readonly markers: readonly StepMarkerRange[]; readonly findings: readonly Finding[] } {
  const { steps, lists, markers, findings } = inspectSteps(path, source, runtime, contentCache);
  return { steps, lists, markers, findings };
}
