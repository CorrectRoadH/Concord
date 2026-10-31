import { ConcordError, type Finding, type Repository } from "../model/index.js";
import { buildTrace } from "../domain/trace/index.js";
import { indexConcepts } from "../domain/concepts/index.js";
import { inlineLinks, markdownLinks, relativeMarkdownLink, relativeMarkdownLinkTarget } from "../domain/taste/index.js";
import { checkWriting } from "../domain/writing/index.js";
import { canonicalPath } from "../model/index.js";

// @concord-code
// @concord-implements docs/feature/documentation-quality/use-case/inspect-writing.md#编辑期间的合并检查
// @concord-implements docs/feature/local-sdlc/use-case/review-traceability.md#check
export function checkProject(repo: Repository, cache: 'use' | 'off' | 'rebuild' = 'use') {
  const trace = buildTrace(repo, cache);
  const unreadablePaths = new Set<string>();
  const conceptLinks: { code: string; path: string; line: number; message: string; category: 'relation' }[] = [];
  let conceptLinksComplete = true;
  const catalogs = indexConcepts(repo).catalogs;
  const catalogPaths = new Set(catalogs.map(catalog => catalog.path));
  for (const path of repo.files('docs').filter(path => path.endsWith('.md') && !path.startsWith('docs/_template/'))) {
    let source: string | undefined;
    try { source = repo.read(path); }
    catch (cause) { conceptLinksComplete = false; conceptLinks.push({ category: 'relation', code: cause instanceof ConcordError ? cause.code : 'SourceReadFailed', path, line: 1, message: cause instanceof Error ? cause.message : String(cause) }); continue; }
    if (source === undefined) { conceptLinksComplete = false; conceptLinks.push({ category: 'relation', code: 'SourceChanged', path, line: 1, message: 'File disappeared while terminology links were read' }); continue; }
    if (!catalogPaths.has(path) && !/concepts|[%&]/iu.test(source)) continue;
    for (const link of inlineLinks(source, path)) for (const catalog of catalogs) {
      const target = relativeMarkdownLinkTarget(path, link.url, catalog.path);
      if (target === undefined || target.kind === 'whole') continue;
      if (target.kind === 'invalid') { conceptLinksComplete = false; conceptLinks.push({ category: 'relation', code: 'ConceptLinkInvalid', path, line: link.line, message: target.message }); break; }
      else if (!catalog.catalog.concepts.some(concept => concept.id === target.id)) conceptLinks.push({ category: 'relation', code: 'AnchorNotFound', path, line: link.line, message: `Concept ${catalog.path}#${target.id} does not exist` });
    }
  }
  // A stable I/O failure is incomplete input, rather than an edit to retry.
  // Keep the taste scan's own semantics unchanged outside this aggregate.
  const relationFindings = trace.findings.map(finding => ({ ...finding,
    code: finding.code === 'SourceChanged' && unreadablePaths.has(finding.path) ? 'SourceReadFailed' : finding.code,
    category: 'relation' as const,
  }));
  let writingFindings: { category: 'writing'; code: string; path: string; line?: number; message: string }[] = [];
  let writingComplete = true;
  try {
    const writing = checkWriting(repo, undefined, cache !== 'off');
    writingFindings = writing.findings.map(finding => ({
      category: 'writing', code: finding.rule, path: finding.file, line: finding.line, message: finding.message,
    }));
  } catch (cause) {
    const error = cause instanceof ConcordError ? cause : cause instanceof Error && 'code' in cause && ['EACCES', 'EPERM', 'EIO'].includes(String(cause.code)) ? new ConcordError('WritingInputUnreadable', cause.message) : undefined;
    if (error === undefined) throw cause;
    writingComplete = false;
    writingFindings = [{ category: 'writing', code: error.code, path: 'docs', message: error.message }];
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
    cache: trace.annotations.cache, codeCache: trace.codeCache,
  };
}
