// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
import { historicalAnalysis } from "../model/index.js";

import { ConcordError, digest } from "../model/index.js";


import { readRepositoryFileSync } from "../base/workspace/index.js";
import { decodeDocumentSource } from "../domain/documents/index.js";
import { parseConstitution } from "../domain/constitution/index.js";

import { type QueryValue } from "../model/index.js";

/** Owner bodies are read through the repository's single standalone path guard. */
export function readQueryBody(root: string, path: string): string {
  const source = readRepositoryFileSync(root, path);
  if (source === undefined) throw new ConcordError('BodyUnavailable', `${path} no longer exists`);
  return source;
}
export function hydrateQueryValue(root: string, value: QueryValue, read = readQueryBody) {
  const bodyChanged: string[] = [], bodyUnavailable: { path: string; code: string }[] = [];
  const body = (path: string, expected: string, constitution: boolean) => {
    try {
      const source = read(root, path);
      if (digest(source) !== expected) { bodyChanged.push(path); return undefined; }
      const owner = constitution ? parseConstitution(source) : decodeDocumentSource(path, source);
      if (!owner) throw new ConcordError('InvalidData', 'Expected a Concord owner');
      return owner;
    } catch (cause) {
      bodyUnavailable.push({ path, code: cause instanceof ConcordError ? cause.code : (cause as NodeJS.ErrnoException).code ?? 'BodyUnavailable' });
      return undefined;
    }
  };
  const output = 'segments' in value ? { operation: 'cached-query', body: value.segments.map(segment => 'text' in segment ? segment.text : body(segment.constitution.path, segment.constitution.digest, true)?.body.trimEnd() ?? '(constitution changed since projection; use --fresh)').join('') }
    : value.operation === 'trace-show' ? (() => {
      const restored = body(value.subject.path, value.subject.digest, false);
      const analysis = value.analysis === undefined ? undefined : historicalAnalysis(value.analysis);
      const staleGroups = analysis === undefined || value.analysis?.observations.length === 0 ? value.stepGroups : value.stepGroups.map(group => {
        const historical = <T extends typeof group.wholeUseCase>(item: T): T => ({ ...item, relevance: item.relevance.map(row => analysis.relevance.find(current => current.testId === row.testId) ?? row) });
        return { ...group, steps: group.steps.map(historical), wholeUseCase: historical(group.wholeUseCase), nonStepAnchors: group.nonStepAnchors.map(historical), observation: { result: 'not-observed' as const, gaps: ['SnapshotNotCurrent'] } };
      });
      return { ...value, stepGroups: staleGroups, ...(analysis === undefined ? {} : { analysis }), subject: restored === undefined ? value.subject : { path: value.subject.path, metadata: restored.metadata, body: restored.body, digest: value.subject.digest } };
    })() : value;
  return { value: output, bodyChanged: [...new Set(bodyChanged)].sort(), bodyUnavailable };
}
