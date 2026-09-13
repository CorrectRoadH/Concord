// @concord-file code-command-interface
// @concord-implements docs/feature/local-sdlc/use-case/trace-code-ownership.md
import { resolveReference } from './documents.js';
import { buildTrace, requireValidTrace } from './trace.js';
import { ConcordError, digest, slug, type Repository } from './shared.js';

// Code Declaration: an author's explicit implementation association, not evidence.
// @concord-code list-code-ownership
// @concord-implements docs/feature/local-sdlc/use-case/trace-code-ownership.md
export function listCode(repo: Repository) {
  const trace = buildTrace(repo, 'off'); requireValidTrace(trace);
  return { operation: 'code-list', codes: trace.codeDeclarations, sourceRoots: repo.config.sourceRoots ?? [] };
}

export function showCode(repo: Repository, id: string) {
  const { codes } = listCode(repo);
  const code = codes.find(item => item.id === id);
  if (!code) throw new ConcordError('CodeNotFound', `No code declaration has ID ${id}`);
  return { operation: 'code-show', code };
}

export function locateCode(repo: Repository, file: string, line: number) {
  repo.absolute(file);
  if (!Number.isSafeInteger(line) || line < 1) throw new ConcordError('InvalidCodeLine', '--line must be a positive integer');
  const trace = buildTrace(repo, 'off'); requireValidTrace(trace);
  const scanned = trace.codeFiles.find(item => item.path === file);
  if (!scanned) throw new ConcordError('CodeSourceNotScanned', `${file} is not a JS/TS file inside configured sourceRoots`);
  const text = repo.read(file);
  if (text === undefined || digest(text) !== scanned.digest) throw new ConcordError('CodeSourceChanged', `${file} changed during the location query`);
  if (line > text.split(/\r\n|\r|\n/u).length) throw new ConcordError('InvalidCodeLine', `Line ${line} is outside ${file}`);
  return { operation: 'code-locate', file, line, codes: trace.codeDeclarations.filter(item => item.file === file && item.line <= line && line <= item.endLine) };
}

export function codeSnippet(repo: Repository, id: string, scope: 'file' | 'node' | 'region', contracts: readonly string[]) {
  slug(id);
  if (!contracts.length) throw new ConcordError('MissingCodeContract', 'Repeat --contract for one or more Feature or Use Case references');
  if (new Set(contracts).size !== contracts.length) throw new ConcordError('DuplicateCodeContract', 'Each exact contract reference must appear once');
  const trace = buildTrace(repo, 'off'); requireValidTrace(trace);
  if (trace.codeDeclarations.some(item => item.id === id)) throw new ConcordError('CodeExists', `${id} is already declared; edit its existing annotations`);
  for (const ref of contracts) resolveReference(repo, trace.documents, ref, ['feature', 'use-case']);
  // @concord-begin render-code-annotation
  // @concord-implements docs/feature/local-sdlc/use-case/trace-code-ownership.md
  const tag = scope === 'node' ? 'code' : scope === 'region' ? 'begin' : 'file';
  const snippet = [`// @concord-${tag} ${id}`, ...contracts.map(ref => `// @concord-implements ${ref}`), ...(scope === 'region' ? ['// Place complete statements here.', `// @concord-end ${id}`] : [])].join('\n') + '\n';
  // @concord-end render-code-annotation
  return { operation: 'code-annotate', id, scope, snippet };
}
