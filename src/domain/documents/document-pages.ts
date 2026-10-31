import { Effect } from 'effect';
import { posix } from "node:path";
import { ConcordError, failure, digest, decode, DocumentName, inRepositorySnapshot, type DocumentKind, type MutationReceipt, type Repository } from "../../model/index.js";
import { documentPlacementError, isDocumentName } from "../../model/index.js";
import { findDocument, loadDocuments, setAuthor } from "./documents.js";
import { templateCatalog } from "./templates.js";
import { TEMPLATE_PAGES } from "../../model/index.js";
import { canonicalPath } from "../../model/index.js";

export type DocumentPage = string;

// @concord-begin
// @concord-implements docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md#edit-page
function checkedPage(value: string): DocumentPage {
  if (value === 'README') return value;
  try { return decode(DocumentName, value, 'page'); }
  catch { throw new ConcordError('InvalidPage', `Page must be a single name using Unicode letters, marks, numbers, or single hyphens: ${value}`); }
}

function body(value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new ConcordError('InvalidInput', 'body must be non-empty');
  if (/^(?:\uFEFF)?---(?:\r?\n|$)/u.test(value)) throw new ConcordError('InvalidAuthorBody', 'Page body cannot contain a leading YAML frontmatter block');
  return value.endsWith('\n') ? value : `${value}\n`;
}

function pagePath(repo: Repository, kind: DocumentKind, selector: string, page: string, plan?: string, creating = false): { path: string; title: string } {
  const packageKinds: readonly DocumentKind[] = ['feature', 'roadmap', 'engineering'];
  if (!packageKinds.includes(kind)) throw new ConcordError('InvalidDocumentKind', `${kind} does not have a document package`);
  const value = checkedPage(page);
  const owner = findDocument(loadDocuments(repo), selector, kind);
  const placement = documentPlacementError(kind, owner.path);
  if (placement !== undefined) throw new ConcordError('InvalidPlacement', `${owner.path}: ${placement}`);
  const title = owner.metadata.title;
  if (value === 'README' || value === 'readme') {
    if (plan !== undefined) throw new ConcordError('InvalidOption', 'Document packages do not accept --plan');
    return { path: owner.path, title };
  }
  if (plan !== undefined) throw new ConcordError('InvalidOption', 'Document packages do not accept --plan');
  const suffix = value === 'use-case' ? 'use-case/README.md' : `${value}.md`;
  return { path: `${posix.dirname(owner.path)}/${suffix}`, title };
}

function template(page: DocumentPage): string | undefined {
  if (page === 'README' || page === 'readme' || page === 'README.md') throw new ConcordError('PageExists', 'Owner README already exists');
  if (page === 'use-case') return 'use-case-index';
  return ['library', 'cli', 'architecture'].includes(page) ? page : undefined;
}
// @concord-end

// @concord-begin
// @concord-implements docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md#edit-page
export const addPage = Effect.fn('addPage')(function*(repo: Repository, kind: DocumentKind, selector: string, page: string, dryRun = false, plan?: string) {
  const catalog = yield* templateCatalog();
  return yield* Effect.try({ try: (): MutationReceipt => inRepositorySnapshot(repo, () => {
  const target = pagePath(repo, kind, selector, page, plan, true);
  if (repo.read(target.path) !== undefined) throw new ConcordError('PageExists', `${target.path} already exists`);
  const name = template(checkedPage(page));
  const content = name === undefined ? `# ${target.title}: ${page}\n\nDescribe this topic and link to the package contract.\n` : catalog.render(name, target.title, []);
  return repo.publish('add-page', [{ path: target.path, before: null, after: body(content) }], dryRun);
  }), catch: failure });
});
// @concord-end

// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md#edit-page
export function showPage(repo: Repository, kind: DocumentKind, selector: string, page: string, plan?: string): { operation: string; path: string; body: string; digest: string } {
  return inRepositorySnapshot(repo, () => {
  const target = pagePath(repo, kind, selector, page, plan); const source = repo.read(target.path);
  if (source === undefined) throw new ConcordError('PageNotFound', `${target.path} does not exist`);
  if ((page === 'README' || page === 'readme') && plan === undefined) {
    const owner = findDocument(loadDocuments(repo), selector, kind);
    return { operation: 'show-page', path: target.path, body: owner.body, digest: owner.digest };
  }
  return { operation: 'show-page', path: target.path, body: source, digest: digest(source) };
  });
}

// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md#edit-page
export function setPage(repo: Repository, kind: DocumentKind, selector: string, page: string, next: string, expectedDigest: string, dryRun = false, plan?: string): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
  const target = pagePath(repo, kind, selector, page, plan); const source = repo.read(target.path);
  if (source === undefined) throw new ConcordError('PageNotFound', `${target.path} does not exist`);
  if (digest(source) !== expectedDigest) throw new ConcordError('FileChangedSinceRead', `${target.path} changed; use its current digest`);
  if ((page === 'README' || page === 'readme') && plan === undefined) return setAuthor(repo, target.path, next, expectedDigest, dryRun);
  return repo.publish('set-page', [{ path: target.path, before: source, after: body(next) }], dryRun);
  });
}
