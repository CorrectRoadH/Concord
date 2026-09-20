// @concord-file
// @concord-implements docs/feature/document-packages/use-case/organize-freeform-research.md
// @concord-implements docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
import { posix } from 'node:path';
import { ConcordError, digest, slug, type DocumentKind, type MutationReceipt, type Repository } from './shared.js';
import { findDocument, loadDocuments, setAuthor } from './documents.js';
import { templateBody, TEMPLATE_PAGES } from './templates.js';
import { canonicalPath } from './storage.js';

export type DocumentPage = string;

function checkedPage(value: string): DocumentPage {
  if (value === 'README') return value;
  try { return slug(value); }
  catch { throw new ConcordError('InvalidPage', `Page must be a lowercase slug: ${value}`); }
}

function body(value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new ConcordError('InvalidInput', 'body must be non-empty');
  if (/^(?:\uFEFF)?---(?:\r?\n|$)/u.test(value)) throw new ConcordError('InvalidAuthorBody', 'Page body cannot contain a leading YAML frontmatter block');
  return value.endsWith('\n') ? value : `${value}\n`;
}

function pagePath(repo: Repository, kind: DocumentKind, selector: string, page: string, plan?: string): { path: string; title: string } {
  const packageKinds: readonly DocumentKind[] = ['feature', 'roadmap', 'design', 'engineering', 'research'];
  if (!packageKinds.includes(kind)) throw new ConcordError('InvalidDocumentKind', `${kind} does not have a document package`);
  if (kind === 'research') {
    if (plan !== undefined) throw new ConcordError('InvalidPlan', '--plan is only valid for Design alternatives');
    const documents = loadDocuments(repo);
    const owner = findDocument(documents, selector, kind);
    const relative = ['README', 'readme', 'README.md'].includes(page) ? 'README.md' : page.endsWith('.md') ? page : `${page}.md`;
    canonicalPath(page);
    canonicalPath(relative);
    const path = `${posix.dirname(owner.path)}/${relative}`;
    const nested = documents.find(document => document.path !== owner.path && document.path.endsWith('/README.md') && path.startsWith(`${posix.dirname(document.path)}/`));
    if (nested !== undefined) throw new ConcordError('InvalidPageOwner', `${path} belongs to ${nested.path}; select that Research topic`);
    return { path, title: owner.metadata.title };
  }
  const value = checkedPage(page);
  const owner = findDocument(loadDocuments(repo), selector, kind);
  if (owner.path !== `docs/${kind}/${owner.metadata.id}/README.md`) throw new ConcordError('InvalidPlacement', `Invalid package owner placement: ${owner.path}`);
  const title = owner.metadata.title;
  if (value === 'README' || value === 'readme') {
    if (kind === 'design' && plan !== undefined) {
      if (owner.metadata.kind !== 'design' || !owner.metadata.alternatives.includes(plan)) throw new ConcordError('InvalidPlan', `${plan} is not a declared Design alternative`);
      return { path: `${posix.dirname(owner.path)}/plans/${plan}/README.md`, title };
    }
    if (plan !== undefined) throw new ConcordError('InvalidPlan', '--plan is only valid for Design alternatives');
    return { path: owner.path, title };
  }
  const outer = new Map<DocumentPage, string>([['goals', 'GOALS.md'], ['limits', 'LIMITS.md'], ['decision', 'DECISION.md'], ['cases', 'CASES.md']]);
  if (kind === 'design') {
    if (plan === undefined) {
      const file = outer.get(value) ?? `${value}.md`;
      if (TEMPLATE_PAGES.some(page => page === value)) throw new ConcordError('InvalidPage', 'Design template plan pages require --plan');
      return { path: `${posix.dirname(owner.path)}/${file}`, title };
    }
    if (owner.metadata.kind !== 'design' || !owner.metadata.alternatives.includes(plan)) throw new ConcordError('InvalidPlan', `${plan} is not a declared Design alternative`);
    if (outer.has(value)) throw new ConcordError('InvalidPage', 'Design outer pages cannot be placed in a plan');
    const suffix = value === 'use-case' ? 'use-case/README.md' : `${value}.md`;
    return { path: `${posix.dirname(owner.path)}/plans/${plan}/${suffix}`, title };
  }
  if (plan !== undefined) throw new ConcordError('InvalidPlan', '--plan is only valid for Design alternatives');
  const suffix = value === 'use-case' ? 'use-case/README.md' : `${value}.md`;
  return { path: `${posix.dirname(owner.path)}/${suffix}`, title };
}

function template(page: DocumentPage): string | undefined {
  if (page === 'README' || page === 'readme') throw new ConcordError('PageExists', 'Owner README already exists');
  if (page === 'use-case') return 'use-case-index';
  if (page === 'decision') return 'decision-record';
  return ['library', 'cli', 'architecture', 'lifecycle', 'goals', 'limits', 'cases'].includes(page) ? page : undefined;
}

export function addPage(repo: Repository, kind: DocumentKind, selector: string, page: string, dryRun = false, plan?: string): MutationReceipt {
  const target = pagePath(repo, kind, selector, page, plan);
  if (repo.read(target.path) !== undefined) throw new ConcordError('PageExists', `${target.path} already exists`);
  if (kind === 'research') return repo.publish('add-page', [{ path: target.path, before: null, after: `# ${posix.basename(target.path, '.md')}\n` }], dryRun);
  const name = plan !== undefined && (page === 'README' || page === 'readme') ? 'feature' : template(checkedPage(page));
  const content = name === undefined ? `# ${target.title}: ${page}\n\nDescribe this topic and link to the package contract.\n` : templateBody(name, target.title, []);
  return repo.publish('add-page', [{ path: target.path, before: null, after: body(content) }], dryRun);
}

export function showPage(repo: Repository, kind: DocumentKind, selector: string, page: string, plan?: string): { operation: string; path: string; body: string; digest: string } {
  const target = pagePath(repo, kind, selector, page, plan); const source = repo.read(target.path);
  if (source === undefined) throw new ConcordError('PageNotFound', `${target.path} does not exist`);
  if ((page === 'README' || page === 'readme' || kind === 'research' && page === 'README.md') && plan === undefined) {
    const owner = findDocument(loadDocuments(repo), selector, kind);
    return { operation: 'show-page', path: target.path, body: owner.body, digest: owner.digest };
  }
  return { operation: 'show-page', path: target.path, body: source, digest: digest(source) };
}

export function setPage(repo: Repository, kind: DocumentKind, selector: string, page: string, next: string, expectedDigest: string, dryRun = false, plan?: string): MutationReceipt {
  const target = pagePath(repo, kind, selector, page, plan); const source = repo.read(target.path);
  if (source === undefined) throw new ConcordError('PageNotFound', `${target.path} does not exist`);
  if (digest(source) !== expectedDigest) throw new ConcordError('PreimageChanged', `${target.path} changed; use its current digest`);
  if ((page === 'README' || page === 'readme' || kind === 'research' && page === 'README.md') && plan === undefined) return setAuthor(repo, target.path, next, expectedDigest, dryRun);
  return repo.publish('set-page', [{ path: target.path, before: source, after: body(next) }], dryRun);
}
