// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/link-tests-to-steps.md
import { git, repositoryRuntime } from '../base/workspace/index.ts';
import { specReferenceTokens } from '../domain/code/index.ts';
import { documentMarkdownProjection, makeDocumentProjectionCache } from '../domain/documents/index.ts';
import { markdownLinks } from '../domain/taste/index.ts';
import { ConcordError, parseReference, type Finding, type Repository } from '../model/index.ts';

function githubRepository(remote: string): string | undefined {
  return /^(?:https?:\/\/|ssh:\/\/git@|git@)github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/iu.exec(remote)?.[1]?.toLowerCase();
}

export async function checkExplicitReferences(repo: Repository): Promise<{ readonly findings: readonly Finding[]; readonly complete: boolean }> {
  const findings: Finding[] = [];
  let complete = true;
  const runtime = repositoryRuntime(repo), cache = makeDocumentProjectionCache(runtime);
  const verify = (input: string, path: string, line: number): void => {
    try {
      const target = parseReference(input);
      if (target.anchor === undefined && repo.readBytes !== undefined) {
        if (repo.readBytes(target.path) === undefined) throw new ConcordError('ReferenceNotFound', `Reference target does not exist: ${target.path}`);
        return;
      }
      const source = repo.read(target.path);
      if (source === undefined) throw new ConcordError('ReferenceNotFound', `Reference target does not exist: ${target.path}`);
      if (target.anchor !== undefined) {
        const projection = documentMarkdownProjection(target.path, source, runtime, cache);
        if (!projection.anchors.includes(target.anchor) && !projection.steps.steps.some(step => step.id === target.anchor)) throw new ConcordError('AnchorNotFound', `Anchor ${target.anchor} does not exist in ${target.path}`);
      }
    } catch (cause) {
      const code = cause instanceof ConcordError ? cause.code : 'SourceReadFailed';
      if (!['ReferenceNotFound', 'AnchorNotFound', 'InvalidReference'].includes(code)) complete = false;
      findings.push({ code, path, line, message: cause instanceof Error ? cause.message : String(cause) });
    }
  };
  try {
    const docs = repo.files('docs').filter(path => path.endsWith('.md'));
    const candidates = docs.flatMap(path => {
      const source = repo.read(path);
      return source === undefined || !source.includes('github.com') ? [] : markdownLinks(source, { references: true }).map(link => ({ ...link, path }));
    });
    if (candidates.length > 0) {
      const remotes = git(repo.root, ['remote', '-v'], runtime.env);
      const repositories = new Set(remotes.split('\n').flatMap(line => {
        const repository = githubRepository(line.split(/\s+/u)[1] ?? '');
        return repository === undefined ? [] : [repository];
      }));
      for (const link of candidates) {
        const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/[^/]+\/(.+)$/u.exec(link.url);
        if (match === null || !repositories.has(match[1]!.toLowerCase())) continue;
        try {
          const url = new URL(link.url);
          const path = decodeURIComponent(url.pathname.split('/').slice(5).join('/'));
          verify(path + (url.hash ? `#${decodeURIComponent(url.hash.slice(1))}` : ''), link.path, link.line);
        } catch (cause) {
          findings.push({ code: 'InvalidReference', path: link.path, line: link.line, message: cause instanceof Error ? cause.message : String(cause) });
        }
      }
    }
    for (const path of new Set(repo.config.sourceRoots.flatMap(root => repo.files(root, 'source')))) {
      const source = repo.read(path);
      if (source === undefined || !source.includes('@spec')) continue;
      for (const token of await specReferenceTokens(path, source)) verify(token.reference, path, token.line);
    }
  } catch (cause) {
    complete = false;
    findings.push({ code: cause instanceof ConcordError ? cause.code : 'SourceReadFailed', path: '.', message: cause instanceof Error ? cause.message : String(cause) });
  } finally { cache.close(); }
  return { findings, complete };
}
