// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import { ConcordError, ProjectSchema, decode, digest, inRepositorySnapshot, type DocumentRecord, type Finding, type MutationReceipt, type ProjectConfig, type Repository } from './shared.js';
import { renderTypeScriptConfig } from './config.js';
import { documentRoots, parseDocumentRecord, setAuthor, setDocumentMetadata } from './documents.js';
import type { LocalRepository } from './storage.js';

export interface ViewFile {
  readonly path: string;
  readonly body: string;
  readonly digest: string;
  readonly readOnly: boolean;
  readonly reason?: string;
  readonly documentPath?: string;
}

const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/u;
const CONSTITUTION_PATH = 'docs/constitution.md';
const WRITABLE_PROJECT_PAGES = new Set(['docs/README.md', 'docs/concord.md', 'docs/concepts.md', 'docs/architecture.md']);
const sourceForbidden = (path: string): boolean => path.split('/').some(part => part === '.git' || part === 'node_modules');
const claimsConcordOwner = (source: string): boolean => /(?:^|\n)\s*format\s*:[^\n]*concord\.document\//u.test(source.slice(0, 64 * 1024));
const hasFrontmatter = (source: string): boolean => /^(?:\uFEFF)?---(?:\r?\n|$)/u.test(source);
const underRoot = (path: string, root: string): boolean => path === root || path.startsWith(`${root}/`);

function isLooseProjectDoc(path: string, roots: readonly string[]): boolean {
  return path.startsWith('docs/') && path.endsWith('.md') && !sourceForbidden(path) && !roots.some(root => underRoot(path, root));
}

function writableProjectPage(path: string): boolean {
  return WRITABLE_PROJECT_PAGES.has(path) || /^docs\/_template\/.+\.md$/u.test(path);
}

function projectPage(path: string, source: string): ViewFile {
  const base = { path, body: source, digest: digest(source) };
  if (path === CONSTITUTION_PATH) return { ...base, readOnly: true, reason: 'The constitution is maintained through constitution adopt and amend. This view is read-only and is not compliance evidence.' };
  if (!writableProjectPage(path)) return { ...base, readOnly: true, reason: 'This project document is outside the writable owner set and is shown read-only.' };
  if (hasFrontmatter(source)) return { ...base, readOnly: true, reason: 'Project documents that begin with frontmatter cannot be rewritten through the supporting-page editor.' };
  return { ...base, readOnly: false };
}

function markdownPaths(repo: Repository, roots: readonly string[]): readonly string[] {
  const markdown = (prefix: string) => repo.files(prefix).filter(path => path.endsWith('.md') && !sourceForbidden(path));
  const outsideDocs = roots.filter(root => root !== 'docs' && !root.startsWith('docs/')).flatMap(markdown);
  return [...new Set([...markdown('docs'), ...outsideDocs])].sort();
}

function inspectMarkdown(repo: Repository, path: string, roots: readonly string[]): { document?: DocumentRecord; page?: ViewFile; finding?: Finding } {
  const source = repo.read(path);
  if (source === undefined) return {};
  try {
    const document = parseDocumentRecord(path, source);
    if (document) return { document };
    if (path === CONSTITUTION_PATH || isLooseProjectDoc(path, roots)) return { page: projectPage(path, source) };
    return { page: { path, body: source, digest: digest(source), readOnly: false } };
  } catch (cause) {
    if (!claimsConcordOwner(source)) return { page: { path, body: source, digest: digest(source), readOnly: false } };
    return {
      finding: { code: cause instanceof ConcordError ? cause.code : 'InvalidData', path, message: cause instanceof Error ? cause.message : String(cause) },
      page: { path, body: source, digest: digest(source), readOnly: true, reason: 'Malformed Concord owner metadata is read-only. Repair the original source locally before editing managed content.' },
    };
  }
}

/** Read only the requested Markdown and its owner chain, using the same classification as the full inventory. */
export function inspectDocumentFile(repo: Repository, path: string): ViewFile | undefined {
  return inRepositorySnapshot(repo, () => {
  const roots = documentRoots(repo);
  const loose = path === CONSTITUTION_PATH || isLooseProjectDoc(path, roots);
  const inDocumentInventory = roots.some(root => underRoot(path, root));
  if (!path.endsWith('.md') || sourceForbidden(path) || (!inDocumentInventory && !loose)) return undefined;
  const target = inspectMarkdown(repo, path, roots);
  if (target.document) return { path, body: target.document.body, digest: target.document.digest, readOnly: false, documentPath: path };
  if (!target.page) return undefined;
  if (loose) return target.page;
  let owner: string | undefined;
  const segments = path.split('/');
  for (let depth = 1; depth < segments.length; depth += 1) {
    const ancestorPath = `${segments.slice(0, depth).join('/')}/README.md`;
    if (!roots.some(root => underRoot(ancestorPath, root))) continue;
    const ancestor = ancestorPath === path ? target : inspectMarkdown(repo, ancestorPath, roots);
    if (ancestor.page?.readOnly) return { ...target.page, readOnly: true, reason: `Repair malformed owner ${ancestorPath} before editing this directory.` };
    if (ancestor.document) owner = ancestorPath;
  }
  return owner ? { ...target.page, documentPath: owner } : target.page;
  });
}

function inspected(repo: Repository): { readonly documents: readonly DocumentRecord[]; readonly findings: readonly Finding[]; readonly pages: readonly ViewFile[] } {
  const roots = documentRoots(repo);
  const documents: DocumentRecord[] = [];
  const findings: Finding[] = [];
  const pages: ViewFile[] = [];
  for (const path of markdownPaths(repo, roots)) {
    const value = inspectMarkdown(repo, path, roots);
    if (value.document) documents.push(value.document);
    if (value.page) pages.push(value.page);
    if (value.finding) findings.push(value.finding);
  }
  const packageOwners = documents.filter(document => document.path.endsWith('/README.md'))
    .sort((left, right) => right.path.length - left.path.length);
  const ownedPages = pages.map(page => {
    if (page.path === CONSTITUTION_PATH || isLooseProjectDoc(page.path, roots)) return page;
    const malformedBoundary = pages.find(candidate => candidate.readOnly && candidate.path.endsWith('/README.md') && page.path.startsWith(candidate.path.slice(0, -'README.md'.length)));
    if (malformedBoundary) return { ...page, readOnly: true, reason: `Repair malformed owner ${malformedBoundary.path} before editing this directory.` };
    const owner = packageOwners.find(document => page.path.startsWith(document.path.slice(0, -'README.md'.length)));
    return owner ? { ...page, documentPath: owner.path } : page;
  });
  return {
    documents,
    findings: findings.sort((left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code)),
    pages: ownedPages,
  };
}

export function inspectDocuments(repo: Repository): { documents: DocumentRecord[]; findings: Finding[]; pages: ViewFile[] } {
  return repo.snapshot === undefined ? inspectDocumentsUnderSnapshot(repo) : repo.snapshot(() => inspectDocumentsUnderSnapshot(repo));
}
function inspectDocumentsUnderSnapshot(repo: Repository): { documents: DocumentRecord[]; findings: Finding[]; pages: ViewFile[] } {
  const value = inspected(repo);
  return { documents: [...value.documents], findings: [...value.findings], pages: [...value.pages] };
}

export function listSources(repo: LocalRepository): { path: string; digest: string }[] {
  return inRepositorySnapshot(repo, () => {
  const roots = [...new Set([...repo.config.testRoots, ...(repo.config.sourceRoots ?? [])])].sort();
  const paths = [...new Set(roots.flatMap(root => repo.files(root)))].filter(path => SOURCE_EXTENSION.test(path) && !sourceForbidden(path)).sort();
  return paths.flatMap(path => {
    const body = repo.read(path);
    return body === undefined ? [] : [{ path, digest: digest(body) }];
  });
  });
}

export function readSource(repo: LocalRepository, path: string): { operation: string; path: string; body: string; digest: string } {
  return inRepositorySnapshot(repo, () => {
  if (!isSourcePath(repo, path)) throw new ConcordError('SourceNotFound', 'The requested source is not an existing JS/TS file in configured sourceRoots or testRoots');
  const body = repo.read(path);
  if (body === undefined) throw new ConcordError('SourceNotFound', `${path} disappeared while reading`);
  return { operation: 'show-source', path, body, digest: digest(body) };
  });
}

export function isSourcePath(repo: Repository, path: string): boolean {
  return inRepositorySnapshot(repo, () => {
  return SOURCE_EXTENSION.test(path) && !sourceForbidden(path) && [...repo.config.testRoots, ...(repo.config.sourceRoots ?? [])].some(root => path === root || path.startsWith(`${root}/`));
  });
}

export function setSource(repo: LocalRepository, path: string, body: string, expectedDigest: string, dryRun = false): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
  const source = readSource(repo, path);
  if (source.digest !== expectedDigest) throw new ConcordError('PreimageChanged', `${path} changed; use its current digest`);
  return repo.publishSource(path, source.body, body, dryRun);
  });
}

export function showConfig(repo: LocalRepository): { operation: string; config: ProjectConfig; digest: string } {
  return inRepositorySnapshot(repo, () => {
  return { operation: 'show-config', config: repo.configSnapshot.config, digest: repo.configSnapshot.digest };
  });
}

export function setConfig(repo: LocalRepository, config: ProjectConfig, expectedDigest: string, dryRun = false): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
  const current = showConfig(repo);
  if (current.digest !== expectedDigest) throw new ConcordError('PreimageChanged', `${repo.configSnapshot.path} changed; use its current digest`);
  const next = decode(ProjectSchema, config, 'configuration');
  if (next.format !== current.config.format || next.projectId !== current.config.projectId) throw new ConcordError('ImmutableProjectIdentity', 'config.set preserves project format and projectId');
  for (const path of [...next.testRoots, ...(next.sourceRoots ?? []), ...next.runner.sourceFiles]) repo.absolute(path);
  for (const root of [...next.testRoots, ...(next.sourceRoots ?? [])]) if (sourceForbidden(root)) throw new ConcordError('InvalidSourcePath', `Unsafe sourceRoot or testRoot: ${root}`);
  const after = renderTypeScriptConfig(next);
  return repo.publish('set-config', [{ path: repo.configSnapshot.path, before: repo.configSnapshot.source, after }], dryRun);
  });
}

export function setMetadata(repo: LocalRepository, reference: string, fields: { title?: string; observedAt?: string | null; sources?: readonly string[]; constitutionRefs?: readonly string[] }, expectedDigest: string, dryRun = false): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
  return setDocumentMetadata(repo, reference, fields, expectedDigest, dryRun);
  });
}

function pageBody(value: string): string {
  if (value.trim().length === 0) throw new ConcordError('InvalidInput', 'body must be non-empty');
  if (/^(?:\uFEFF)?---(?:\r?\n|$)/u.test(value)) throw new ConcordError('InvalidAuthorBody', 'Supporting Markdown cannot begin with frontmatter');
  return value.endsWith('\n') ? value : `${value}\n`;
}

export function setMarkdown(repo: LocalRepository, path: string, body: string, expectedDigest: string, dryRun = false): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
  const page = inspectDocumentFile(repo, path);
  if (page === undefined) throw new ConcordError('FileNotFound', 'Markdown editing is limited to the Concord document and supporting-page inventory');
  if (page.readOnly) throw new ConcordError('ReadOnlyDocument', page.reason ?? `${path} is read-only`);
  if (page.documentPath === path) return setAuthor(repo, path, body, expectedDigest, dryRun);
  if (page.digest !== expectedDigest) throw new ConcordError('PreimageChanged', `${path} changed; use its current digest`);
  const before = repo.read(path);
  if (before === undefined) throw new ConcordError('FileNotFound', `${path} disappeared before publication`);
  return repo.publish('set-markdown', [{ path, before, after: pageBody(body) }], dryRun);
  });
}
