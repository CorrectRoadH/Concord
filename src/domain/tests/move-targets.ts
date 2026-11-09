// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/move-spec-documents.md#apply
import { ConcordError, rewriteMarkerTargets } from '../../model/index.ts';
import { parseTestDeclarations } from './annotations.ts';

export async function moveTestTargets(path: string, source: string, map: (target: string) => string): Promise<string> {
  const parsed = await parseTestDeclarations(path, source);
  if (parsed.findings.length) throw new ConcordError('ReferenceScanIncomplete', `Invalid test markers in ${path}`, parsed.findings);
  return rewriteMarkerTargets(source, parsed.cases.map(item => ({ line: item.line, reference: item.contract, family: item.contractKind })), map);
}
