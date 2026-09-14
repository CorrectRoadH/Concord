// @concord-file workbench-editing
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import { ConcordError, ProjectSchema, decode, digest, type DocumentRecord, type Finding, type MutationReceipt, type ProjectConfig, type Repository } from './shared.js';
import { DOCUMENT_ROOTS, parseDocumentRecord, setAuthor, setDocumentMetadata } from './documents.js';
import { applyLegacyPageOwnership, inspectLegacyView, LEGACY_REASON } from './legacy-view.js';
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
const sourceForbidden = (path: string): boolean => path.split('/').some(part => part === '.git' || part === 'node_modules');
const claimsConcordOwner = (source: string): boolean => /(?:^|\n)\s*format\s*:[^\n]*concord\.document\//u.test(source.slice(0, 64 * 1024));

function markdownPaths(repo: Repository): readonly string[] {
  return [...new Set(DOCUMENT_ROOTS.flatMap(root => repo.files(root).filter(path => path.endsWith('.md'))))].sort();
}

function inspected(repo: Repository): { readonly documents: readonly DocumentRecord[]; readonly findings: readonly Finding[]; readonly pages: readonly ViewFile[]; readonly legacyDocuments: ReturnType<typeof inspectLegacyView>['documents'] } {
  const documents: DocumentRecord[] = [];
  const findings: Finding[] = [];
  const pages: ViewFile[] = [];
  const legacy = inspectLegacyView(repo);
  const legacyOwners = new Set(legacy.documents.map(document => document.path));
  for (const path of markdownPaths(repo)) {
    const source = repo.read(path);
    if (source === undefined) continue;
    try {
      const document = parseDocumentRecord(path, source);
      if (document !== undefined) {
        documents.push(document);
        continue;
      }
      if (legacyOwners.has(path)) continue;
      pages.push({ path, body: source, digest: digest(source), readOnly: false });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (!claimsConcordOwner(source)) {
        pages.push({ path, body: source, digest: digest(source), readOnly: false });
        continue;
      }
      const error = cause instanceof ConcordError ? cause.code : 'InvalidData';
      findings.push({ code: error, path, message });
      pages.push({ path, body: source, digest: digest(source), readOnly: true, reason: 'Malformed Concord owner metadata is read-only. Repair the original source locally before editing managed content.' });
    }
  }
  const packageOwners = documents.filter(document => document.path.endsWith('/README.md'))
    .sort((left, right) => right.path.length - left.path.length);
  const ownedPages = pages.map(page => {
    const owner = packageOwners.find(document => page.path.startsWith(document.path.slice(0, -'README.md'.length)));
    return owner ? { ...page, documentPath: owner.path } : page;
  });
  return {
    documents,
    findings: [...findings, ...legacy.findings].sort((left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code)),
    pages: applyLegacyPageOwnership(ownedPages, legacy),
    legacyDocuments: legacy.documents,
  };
}

export function inspectDocuments(repo: Repository): { documents: DocumentRecord[]; findings: Finding[]; pages: ViewFile[]; legacyDocuments: ReturnType<typeof inspectLegacyView>['documents'] } {
  const value = inspected(repo);
  return { documents: [...value.documents], findings: [...value.findings], pages: [...value.pages], legacyDocuments: [...value.legacyDocuments] };
}

export function listSources(repo: LocalRepository): { path: string; digest: string }[] {
  const roots = [...new Set([...repo.config.testRoots, ...(repo.config.sourceRoots ?? [])])].sort();
  const paths = [...new Set(roots.flatMap(root => repo.files(root)))].filter(path => SOURCE_EXTENSION.test(path) && !sourceForbidden(path)).sort();
  return paths.flatMap(path => {
    const body = repo.read(path);
    return body === undefined ? [] : [{ path, digest: digest(body) }];
  });
}

export function readSource(repo: LocalRepository, path: string): { operation: string; path: string; body: string; digest: string } {
  if (!listSources(repo).some(source => source.path === path)) throw new ConcordError('SourceNotFound', 'The requested source is not an existing JS/TS file in configured sourceRoots or testRoots');
  const body = repo.read(path);
  if (body === undefined) throw new ConcordError('SourceNotFound', `${path} disappeared while reading`);
  return { operation: 'show-source', path, body, digest: digest(body) };
}

export function setSource(repo: LocalRepository, path: string, body: string, expectedDigest: string, dryRun = false): MutationReceipt {
  const source = readSource(repo, path);
  if (source.digest !== expectedDigest) throw new ConcordError('PreimageChanged', `${path} changed; use its current digest`);
  return repo.publishSource(path, source.body, body, dryRun);
}

export function showConfig(repo: LocalRepository): { operation: string; config: ProjectConfig; digest: string } {
  const source = repo.read('concord.json');
  if (source === undefined) throw new ConcordError('ProjectNotFound', 'concord.json does not exist');
  return { operation: 'show-config', config: decode(ProjectSchema, JSON.parse(source), 'concord.json'), digest: digest(source) };
}

export function setConfig(repo: LocalRepository, config: ProjectConfig, expectedDigest: string, dryRun = false): MutationReceipt {
  const current = showConfig(repo);
  if (current.digest !== expectedDigest) throw new ConcordError('PreimageChanged', 'concord.json changed; use its current digest');
  const next = decode(ProjectSchema, config, 'configuration');
  if (next.format !== current.config.format || next.projectId !== current.config.projectId) throw new ConcordError('ImmutableProjectIdentity', 'config.set preserves project format and projectId');
  for (const path of [...next.testRoots, ...(next.sourceRoots ?? []), ...next.runner.sourceFiles]) repo.absolute(path);
  for (const root of [...next.testRoots, ...(next.sourceRoots ?? [])]) if (sourceForbidden(root)) throw new ConcordError('InvalidSourcePath', `Unsafe sourceRoot or testRoot: ${root}`);
  const after = `${JSON.stringify(next, null, 2)}\n`;
  return repo.publish('set-config', [{ path: 'concord.json', before: currentSource(repo), after }], dryRun);
}

function currentSource(repo: LocalRepository): string {
  const source = repo.read('concord.json');
  if (source === undefined) throw new ConcordError('ProjectNotFound', 'concord.json disappeared before publication');
  return source;
}

export function setMetadata(repo: LocalRepository, reference: string, fields: { title?: string; observedAt?: string; sources?: readonly string[] }, expectedDigest: string, dryRun = false): MutationReceipt {
  const legacy = inspectLegacyView(repo);
  if (legacy.readOnlyPaths.has(reference.split('#')[0] ?? reference)) throw new ConcordError('ReadOnlyDocument', LEGACY_REASON);
  return setDocumentMetadata(repo, reference, fields, expectedDigest, dryRun);
}

function pageBody(value: string): string {
  if (value.trim().length === 0) throw new ConcordError('InvalidInput', 'body must be non-empty');
  if (/^(?:\uFEFF)?---(?:\r?\n|$)/u.test(value)) throw new ConcordError('InvalidAuthorBody', 'Supporting Markdown cannot begin with frontmatter');
  return value.endsWith('\n') ? value : `${value}\n`;
}

export function setMarkdown(repo: LocalRepository, path: string, body: string, expectedDigest: string, dryRun = false): MutationReceipt {
  const inventory = inspectDocuments(repo);
  if (inventory.legacyDocuments.some(document => document.path === path) || inventory.pages.some(page => page.path === path && page.readOnly)) {
    throw new ConcordError('ReadOnlyDocument', LEGACY_REASON);
  }
  const document = inventory.documents.find(item => item.path === path);
  if (document !== undefined) return setAuthor(repo, path, body, expectedDigest, dryRun);
  const page = inventory.pages.find(item => item.path === path);
  if (page === undefined) throw new ConcordError('FileNotFound', 'Markdown editing is limited to the Concord document and supporting-page inventory');
  if (page.readOnly) throw new ConcordError('ReadOnlyDocument', page.reason ?? `${path} is read-only`);
  if (page.digest !== expectedDigest) throw new ConcordError('PreimageChanged', `${path} changed; use its current digest`);
  const before = repo.read(path);
  if (before === undefined) throw new ConcordError('FileNotFound', `${path} disappeared before publication`);
  return repo.publish('set-markdown', [{ path, before, after: pageBody(body) }], dryRun);
}
