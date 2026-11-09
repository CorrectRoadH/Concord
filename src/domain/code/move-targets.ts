// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/move-spec-documents.md#apply
import { rewriteMarkerTargets, type ResolvedProjectConfig } from '../../model/index.ts';
import { codeReferenceTokens } from './code.ts';

export async function moveCodeTargets(path: string, source: string, config: ResolvedProjectConfig, map: (target: string) => string): Promise<string> {
  const tokens = await codeReferenceTokens(path, source, config.languageServers);
  return rewriteMarkerTargets(source, tokens.map(item => ({ ...item, family: 'concord-implements' })), map);
}
