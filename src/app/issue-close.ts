// @concord-file
// @concord-implements docs/feature/feedback/use-case/manage-local-observations.md
import { ConcordError, objectDigest, type Change, type Repository } from '../model/index.ts';
import { readDocumentSelector } from '../domain/documents/index.ts';
import { issueMarkerLines, scanAnnotations } from '../domain/tests/index.ts';

export async function planIssueClose(repo: Repository, request: { readonly issue: string }) {
  const issue = readDocumentSelector(repo, request.issue, 'issue');
  if (issue.path !== request.issue) throw new ConcordError('InvalidReferenceTarget', 'Issue close requires the exact owner path');
  const before = repo.read(issue.path);
  if (before === undefined) throw new ConcordError('SourceChanged', `${issue.path} disappeared`);
  const changes: Change[] = [{ path: issue.path, before, after: null }];
  const testFiles = [...new Set(repo.config.testRoots.flatMap(root => repo.files(root, 'source')))].sort();
  const scan = (await scanAnnotations(repo, { cache: 'off', sourceMode: 'overlay' }));
  for (const file of scan.files) {
    const source = repo.read(file.path);
    if (source === undefined) throw new ConcordError('SourceChanged', `${file.path} disappeared`);
    const removed = new Set((await issueMarkerLines(file.path, source, issue.path)));
    if (!removed.size) continue;
    const after = source.split(/(?<=\n)/u).filter((_line, index) => !removed.has(index + 1)).join('');
    changes.push({ path: file.path, before: source, after });
  }
  return { issue: issue.path, changes, testFiles, inputsDigest: objectDigest({ root: repo.root, privateDir: repo.privateDir, config: repo.configSnapshot.source, testFiles, changes }) };
}
