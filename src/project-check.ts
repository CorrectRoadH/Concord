import { ConcordError, type Finding, type Repository } from './shared.js';
import { buildTrace } from './trace.js';
import { indexConcepts } from './concepts.js';
import { inlineLinks, markdownLinks, relativeMarkdownLink, relativeMarkdownLinkTarget } from './constitution.js';
import { checkWriting } from './writing.js';
import { canonicalPath } from './storage.js';

// @concord-code
// @concord-implements docs/feature/documentation-quality/README.md#聚合门禁
function checkDesignRecordLinks(repo: Repository) {
  const findings: (Finding & { category: 'relation' })[] = [];
  let complete = true;
  const memoryRoots = (repo.config.memorySources ?? []).map(source => source.path);
  const sources = repo.files('docs').filter(path => /\.(?:md|mdx)$/u.test(path) &&
    (/^docs\/[^/]+$/u.test(path) || path.startsWith('docs/feature/') || path.startsWith('docs/engineering/')) &&
    !memoryRoots.some(root => path === root || path.startsWith(`${root}/`))).sort();
  for (const path of sources) {
    let reading = true;
    try {
      const source = repo.read(path);
      if (source === undefined) throw new ConcordError('SourceChanged', 'File disappeared while Design record links were read');
      reading = false;
      for (const link of markdownLinks(source, { references: true, mdx: path.endsWith('.mdx') })) {
        const target = relativeMarkdownLink(path, link.url);
        if (target === undefined) continue;
        if (target.kind === 'invalid') {
          complete = false;
          findings.push({ category: 'relation', code: 'DesignRecordLinkInvalid', path, line: link.line, message: target.message });
          continue;
        }
        try { canonicalPath(target.path); }
        catch (cause) {
          complete = false;
          findings.push({ category: 'relation', code: 'UnsafePath', path, line: link.line, message: cause instanceof Error ? cause.message : String(cause) });
          continue;
        }
        if (!/^docs\/design\/[^/]+\/.+/u.test(target.path) || /^docs\/design\/[^/]+\/(?:README|DECISION)\.md$/u.test(target.path)) continue;
        findings.push({ category: 'relation', code: 'SpecDependsOnDesignRecord', path, line: link.line, message: `Spec links to a Design record page: ${target.path}` });
      }
    } catch (cause) {
      complete = false;
      findings.push({ category: 'relation', code: cause instanceof ConcordError ? cause.code : reading ? 'SourceReadFailed' : 'InvalidMarkdownSource', path, message: cause instanceof Error ? cause.message : String(cause) });
    }
  }
  return { findings, complete };
}

// @concord-code
// @concord-implements docs/feature/documentation-quality/use-case/inspect-writing.md#编辑期间的聚合检查
// @concord-implements docs/feature/local-sdlc/use-case/review-traceability.md#check
export function checkProject(repo: Repository, cache: 'use' | 'off' | 'rebuild' = 'use') {
  const trace = buildTrace(repo, cache);
  const designRecordLinks = checkDesignRecordLinks(repo);
  const unreadablePaths = new Set(designRecordLinks.findings.filter(finding => finding.code === 'SourceReadFailed').map(finding => finding.path));
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
  // Keep the constitution scan's own semantics unchanged outside this aggregate.
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
  const complete = trace.complete && conceptLinksComplete && designRecordLinks.complete && writingComplete;
  const findings = [...relationFindings, ...conceptLinks, ...designRecordLinks.findings, ...writingFindings];
  return {
    operation: 'check', ok: complete && findings.length === 0, complete, findings,
    checks: {
      relations: { ok: trace.complete && conceptLinksComplete && conceptLinks.length === 0 && designRecordLinks.complete && designRecordLinks.findings.length === 0, complete: trace.complete && conceptLinksComplete && designRecordLinks.complete },
      writing: { ok: writingComplete && writingFindings.length === 0, complete: writingComplete },
    },
    advisories: trace.advisories, documents: trace.documents.length,
    cases: trace.annotations.cases.length, codeDeclarations: trace.codeDeclarations.length,
    memoryEvidence: trace.memories, cache: trace.annotations.cache, codeCache: trace.codeCache,
  };
}
