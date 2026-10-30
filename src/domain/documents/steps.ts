import { documentMarkdown, documentMarkdownProjection, projectionRecord } from "./document-projection.js";
import { inspectTreeSteps } from "../../model/markdown-facts.js";
import { ConcordError, type Finding } from "../../model/shared.js";
import { type UseCaseStep, type RootOrderedList, type StepMarkerRange } from "../../model/markdown-facts.js";
export function headingAnchors(source: string, path = 'document.md'): ReadonlySet<string> {
  return new Set(documentMarkdownProjection(path, source).anchors);
}
export function inspectSteps(path: string, source: string) {
  try {
    const projection = documentMarkdownProjection(path, source);
    const owner = projectionRecord(path, projection);
    return { ...projection.steps, get items() {
      return inspectTreeSteps(path, source, owner?.metadata.kind === 'use-case', documentMarkdown(path, source)).items;
    } };
  } catch (cause) {
    return { steps: [], lists: [], markers: [], items: [], findings: [{ code: cause instanceof ConcordError ? cause.code : 'InvalidSteps', path, message: cause instanceof Error ? cause.message : String(cause) }] as Finding[] };
  }
}
export function extractSteps(path: string, source: string): { readonly steps: readonly UseCaseStep[]; readonly lists: readonly RootOrderedList[]; readonly markers: readonly StepMarkerRange[]; readonly findings: readonly Finding[] } {
  const { steps, lists, markers, findings } = inspectSteps(path, source);
  return { steps, lists, markers, findings };
}
