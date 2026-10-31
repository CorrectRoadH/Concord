import { readDocumentReference } from "../documents/index.js";
import { ConcordError, inRepositorySnapshot, type Repository } from "../../model/index.js";




// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/discover-annotated-tests.md#annotate
export function annotationSnippet(repo: Repository, contract: string, issues: readonly string[]) {
  return inRepositorySnapshot(repo, () => {
  const target = readDocumentReference(repo, contract, ['feature', 'use-case']);
  if (new Set(issues).size !== issues.length) throw new ConcordError('DuplicateIssue', 'Each Issue reference must appear once');
  for (const ref of issues) {
    const owner = readDocumentReference(repo, ref, ['issue']);
    if (owner.metadata.kind !== 'issue') throw new ConcordError('InvalidIssue', `${ref} is not an Issue`);
  }
  const tag = target.metadata.kind === 'use-case' ? '@use-case' : '@feature';
  const snippet = [`// ${tag} ${contract}`, ...issues.map(ref => `// @issue ${ref}`)].join('\n') + '\n';
  return { operation: 'test-marker', snippet };
  });
}
