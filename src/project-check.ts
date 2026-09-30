// @concord-file
// @concord-implements docs/feature/documentation-quality/use-case/inspect-writing.md
import { ConcordError, type Repository } from './shared.js';
import { buildTrace } from './trace.js';
import { checkWriting } from './writing.js';

// @concord-code
// @concord-implements docs/engineering/concord-self-hosting/README.md
export function checkProject(repo: Repository, cache: 'use' | 'off' | 'rebuild' = 'use') {
  const trace = buildTrace(repo, cache);
  const relationFindings = trace.findings.map(finding => ({ ...finding, category: 'relation' as const }));
  let writingFindings: { category: 'writing'; code: string; path: string; line?: number; message: string }[] = [];
  let writingComplete = true;
  try {
    const writing = checkWriting(repo);
    writingFindings = writing.findings.map(finding => ({
      category: 'writing', code: finding.rule, path: finding.file, line: finding.line, message: finding.message,
    }));
  } catch (cause) {
    if (!(cause instanceof ConcordError)) throw cause;
    writingComplete = false;
    writingFindings = [{ category: 'writing', code: cause.code, path: 'docs', message: cause.message }];
  }
  const complete = trace.complete && writingComplete;
  const findings = [...relationFindings, ...writingFindings];
  return {
    operation: 'check', ok: complete && findings.length === 0, complete, findings,
    checks: {
      relations: { ok: trace.complete, complete: trace.complete },
      writing: { ok: writingComplete && writingFindings.length === 0, complete: writingComplete },
    },
    advisories: trace.advisories, documents: trace.documents.length,
    cases: trace.annotations.cases.length, codeDeclarations: trace.codeDeclarations.length,
    memoryEvidence: trace.memories, cache: trace.annotations.cache, codeCache: trace.codeCache,
  };
}
