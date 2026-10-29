import { ConcordError, type Repository } from './shared.js';
import { buildTrace } from './trace.js';
import { indexConcepts } from './concepts.js';
import { inlineLinks, relativeMarkdownLinkTarget } from './constitution.js';
import { checkWriting } from './writing.js';
import { withParseCachePolicy } from './cache-context.js';

// @concord-code
// @concord-implements docs/feature/documentation-quality/use-case/inspect-writing.md#编辑期间的聚合检查
// @concord-implements docs/feature/local-sdlc/use-case/review-traceability.md#check
export function checkProject(repo: Repository, cache: 'use' | 'off' | 'rebuild' = 'use') {
  return withParseCachePolicy(cache !== 'off', () => checkProjectWithPolicy(repo, cache));
}
function checkProjectWithPolicy(repo: Repository, cache: 'use' | 'off' | 'rebuild') {
  const trace = buildTrace(repo, cache);
  const conceptLinks: { code: string; path: string; line: number; message: string; category: 'relation' }[] = [];
  let conceptLinksComplete = true;
  const catalogs = indexConcepts(repo).catalogs;
  const catalogPaths = new Set(catalogs.map(catalog => catalog.path));
  for (const path of repo.files('docs').filter(path => path.endsWith('.md') && !path.startsWith('docs/_template/'))) {
    const source = repo.read(path);
    if (source === undefined) { conceptLinksComplete = false; conceptLinks.push({ category: 'relation', code: 'SourceChanged', path, line: 1, message: 'File disappeared while terminology links were read' }); continue; }
    if (!catalogPaths.has(path) && !/concepts|[%&]/iu.test(source)) continue;
    for (const link of inlineLinks(source, path)) for (const catalog of catalogs) {
      const target = relativeMarkdownLinkTarget(path, link.url, catalog.path);
      if (target === undefined || target.kind === 'whole') continue;
      if (target.kind === 'invalid') { conceptLinksComplete = false; conceptLinks.push({ category: 'relation', code: 'ConceptLinkInvalid', path, line: link.line, message: target.message }); break; }
      else if (!catalog.catalog.concepts.some(concept => concept.id === target.id)) conceptLinks.push({ category: 'relation', code: 'AnchorNotFound', path, line: link.line, message: `Concept ${catalog.path}#${target.id} does not exist` });
    }
  }
  const relationFindings = trace.findings.map(finding => ({ ...finding, category: 'relation' as const }));
  let writingFindings: { category: 'writing'; code: string; path: string; line?: number; message: string }[] = [];
  let writingComplete = true;
  try {
    const writing = checkWriting(repo, undefined, cache !== 'off');
    writingFindings = writing.findings.map(finding => ({
      category: 'writing', code: finding.rule, path: finding.file, line: finding.line, message: finding.message,
    }));
  } catch (cause) {
    if (!(cause instanceof ConcordError)) throw cause;
    writingComplete = false;
    writingFindings = [{ category: 'writing', code: cause.code, path: 'docs', message: cause.message }];
  }
  const complete = trace.complete && conceptLinksComplete && writingComplete;
  const findings = [...relationFindings, ...conceptLinks, ...writingFindings];
  return {
    operation: 'check', ok: complete && findings.length === 0, complete, findings,
    checks: {
      relations: { ok: trace.complete && conceptLinksComplete && conceptLinks.length === 0, complete: trace.complete && conceptLinksComplete },
      writing: { ok: writingComplete && writingFindings.length === 0, complete: writingComplete },
    },
    advisories: trace.advisories, documents: trace.documents.length,
    cases: trace.annotations.cases.length, codeDeclarations: trace.codeDeclarations.length,
    memoryEvidence: trace.memories, cache: trace.annotations.cache, codeCache: trace.codeCache,
  };
}
